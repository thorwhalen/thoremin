/**
 * `pace-controller` node (#186 PR H) — the song follows the dancer: the rate the song
 * plays at, from the dancer's pulse (`body-pulse`) and the song's own beat
 * (`song-player`'s `songTime`).
 *
 * The control law is ictus's pace controller (`@thoremin/ictus`, `pace.ts`; the body
 * research map §6.2): the dancer's level is related to the song's beat by an INTEGER
 * ratio (the Que Calor dancer's stride is one bar, four song beats), followed only once
 * the relation has persisted, smoothed over about a second, clamped around the player's
 * own tempo, and nudged by 3 % while the dancer's cycle and the song's beat are more than
 * a twelfth of a beat apart. It holds the last rate below the pulse's trust threshold, so
 * a dancer who stops does not stop the song.
 *
 * It closes a loop with the song player: it reads the song's time and the rate it was
 * played at on DELAYED edges (the previous tick's, extrapolated to now), and its `rate`
 * feeds the player's `followRate` this tick. The player's own `rate` input (the Song
 * tool's tempo) is the controller's `base`, the centre of the clamp, so the slider still
 * means "the tempo I want" while following.
 *
 * It is composed only while following is on (the per-device `songPrefs.follow`) and a
 * song is loaded (the `song-pace` branch), so it costs nothing otherwise.
 *
 * **A conductor leads too (#187 PR 7, "Conduct a recording").** With the conductor's
 * `recordingTime` on `lead`, the same node runs the other law ictus has for a song, the beat servo
 * (`servo.ts`; the conducting research map §6.7): the conductor's beat IS the piece's
 * beat, so the song is held to it beat for beat, its error evaluated at the output
 * timestamp (`ctx.resources.timing`'s output stage), its transport paused while the
 * conductor waits or holds (`playing`) and cued silently to his beat (`cue`), both wired
 * onto the song player's `followPlaying` and `cue`; under the dancer they stay empty and
 * the player's own transport plays. One transport, one beat grid, one node: the leader
 * decides the law.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import { createBeatServo, createPaceController, PACE_DEFAULTS, SERVO_DEFAULTS, UNKNOWN_PULSE, type MusicalTime, type PaceState, type PulseState, type ServoState } from '@thoremin/ictus';
import { timingFrom } from '@thoremin/sdk/timing/tracker';
import type { LoadStatus } from '@thoremin/lazy';
import { songPlayable } from '../output/song_player';

const Params = z.object({
  /** Seconds a ratio must persist before it is followed (the red-noise guard, #339). */
  persistS: z.number().min(0).max(20).default(PACE_DEFAULTS.persistS),
  /** Time constant of the rate's smoothing, seconds. */
  smoothS: z.number().positive().max(10).default(PACE_DEFAULTS.smoothS),
  /** The phase nudge, a fraction of the rate. */
  nudge: z.number().min(0).max(0.2).default(PACE_DEFAULTS.nudge),
  /** Phase error past which the rate is nudged, song beats. */
  phaseThreshold: z.number().positive().max(0.5).default(PACE_DEFAULTS.phaseThreshold),
  /** The largest integer ratio tried, both ways. */
  maxRatio: z.number().int().min(1).max(16).default(PACE_DEFAULTS.maxRatio),
  /** Where the dancer's cycle start (the stride's widest point, for the default channel)
   *  should land, in song beats after a beat. 0 = on the beat. */
  phaseOffset: z.number().min(-0.5).max(0.5).default(PACE_DEFAULTS.phaseOffset),
  /** Seconds the song's own beat period is averaged over. */
  songPeriodS: z.number().positive().max(30).default(PACE_DEFAULTS.songPeriodS),
  /** The song player's own rate limits (its `minRate` / `maxRate`): never asked past. */
  minRate: z.number().positive().default(PACE_DEFAULTS.minRate),
  maxRate: z.number().positive().default(PACE_DEFAULTS.maxRate),
  /** The conductor's law (`lead` connected): the servo's horizon, conductor beats. */
  horizonBeats: z.number().min(0.25).max(8).default(SERVO_DEFAULTS.horizonBeats),
  /** The conductor's law: the largest correction, a fraction of the tempo-matched rate. */
  maxCorrection: z.number().min(0).max(1).default(SERVO_DEFAULTS.maxCorrection),
  /** The conductor's law: a song further adrift than this, in beats, is cued, not chased. */
  seekBeyondBeats: z.number().positive().max(64).default(SERVO_DEFAULTS.seekBeyondBeats),
});
type Params = z.infer<typeof Params>;

const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** A start alignment smaller than this (beats) is left to the nudge. */
const ALIGN_MIN_BEATS = 0.04;
/** The ids of start-alignment cues, apart from the beat servo's own counter (the node's `cue` output carries either). */
const ALIGN_CUE_ID_BASE = 1_000_000_000;

export const paceControllerNode = defineNode<Params>({
  type: 'pace-controller',
  roles: ['music', 'control'],
  title: 'Pace Controller',
  description:
    "Makes the song follow the dancer: relates the dancer's pulse to the song's beat by an integer ratio and sets the song's rate (clamped around the player's tempo, nudged into phase, held when the dancer stops).",
  inputs: [
    { name: 'pulse', kind: 'pulse-state', description: "The dancer's pulse (body-pulse)" },
    { name: 'song', kind: 'musical-time', description: "The song's beat at the playback position (song-player's songTime, a tick old)" },
    { name: 'rate', kind: 'number', default: 1, description: 'The rate the song was played at (song-player\'s rate, a tick old)' },
    { name: 'base', kind: 'number', default: 1, description: "The player's own tempo (the Song tool's slider): the centre of the clamp" },
    { name: 'range', kind: 'number', default: PACE_DEFAULTS.range, description: 'How far from the player\'s tempo the song may be pulled, a fraction' },
    { name: 'lead', kind: 'musical-time', description: "A conductor's time (#187 PR 7): while present, the song follows it beat for beat (the beat servo) instead of the dancer" },
    { name: 'offset', kind: 'number', default: 0, description: "The song's beat on which the conductor's first beat lands" },
    { name: 'songHandle', kind: 'song-handle', description: 'The loaded song (the store\'s handle): a new one restarts both laws (#439)' },
    { name: 'alignStart', kind: 'boolean', default: false, description: "The player's choice (the Song tool): after a Play, move the song ONCE so its beat lands on the dancer's cycle start, instead of closing the phase error through the rate nudge over several seconds (#346 item 1)" },
    { name: 'songStatus', kind: 'load-status', description: "The song player's status, a tick old: neither law leads a song that is not playable yet (#500)" },
  ],
  outputs: [
    { name: 'rate', kind: 'number', description: 'The rate to play the song at' },
    { name: 'pace', kind: 'pace-state', description: 'What the controller is doing: waiting, locking, following or holding, the ratio, the phase error' },
    { name: 'playing', kind: 'boolean', description: "The conductor's law: whether the song plays (paused while the conductor waits or holds)" },
    { name: 'cue', kind: 'song-cue', description: "The conductor's law: the beat the song is moved to (a fresh id per request)" },
    { name: 'servo', kind: 'servo-state', description: "The conductor's law: cueing, following or holding, the rate and the error in beats" },
  ],
  params: Params,
  make(p) {
    const controller = createPaceController(p);
    const servo = createBeatServo(p);
    /** Which law ran last tick: a change of leader starts the other law afresh. */
    let led = false;
    /** The loaded song's id, last seen (`SongHandle.id`, fresh per load). */
    let songId: unknown;
    /** Start alignment (#346 item 1): whether this play has been aligned already, and a counter for the cue ids. */
    let aligned = false;
    let alignCue = 0;
    return {
      process(inputs, ctx) {
        // A song replaced by another (#439): what either law learned about the old one (the
        // level ratio, the re-anchoring shift, the beat period) does not hold for the new one,
        // so both start afresh. For this one tick the song's time on the delayed edge is
        // still the old song's, so neither law steps on it.
        const id = (inputs.songHandle as { id?: unknown } | undefined)?.id;
        const swapped = id !== undefined && songId !== undefined && id !== songId;
        if (id !== undefined) songId = id;
        if (swapped) {
          servo.reset();
          controller.reset();
          aligned = false;
        }
        // A song still loading is not led (#500): the player's `songTime` is then the new
        // song's grid at the OLD position, and a cue made from it would be stale by the time
        // the song plays. Unwired (`songStatus` absent), the song is taken as playable.
        const loading = inputs.songStatus !== undefined && !songPlayable(inputs.songStatus as LoadStatus | null);
        const song = swapped || loading ? undefined : (inputs.song as MusicalTime | undefined);
        const base = finite(inputs.base, 1);
        const lead = inputs.lead as MusicalTime | undefined;
        if (lead && !led) controller.reset();
        if (!lead && led) servo.reset();
        led = !!lead;
        if (lead) {
          // The conductor leads: the beat servo, evaluated at the output timestamp.
          let s: ServoState;
          if (!song) {
            servo.reset();
            s = { ...servo.state(), t: ctx.time };
          } else {
            s = servo.step({
              t: ctx.time,
              lead,
              song,
              rate: finite(inputs.rate, 1),
              latency: timingFrom(ctx.resources).outputStage.value,
              offset: finite(inputs.offset, 0),
            });
          }
          return { rate: s.rate, pace: controller.state(), playing: s.playing, cue: s.cue ?? undefined, servo: s };
        }
        let pace: PaceState;
        if (!song) {
          controller.reset();
          pace = { ...controller.state(), t: ctx.time, rate: base };
        } else {
          pace = controller.step({
            t: ctx.time,
            pulse: (inputs.pulse as PulseState | undefined) ?? UNKNOWN_PULSE,
            song,
            rate: finite(inputs.rate, base),
            base,
            range: finite(inputs.range, PACE_DEFAULTS.range),
          });
        }
        // The song is moved to the dancer's cycle ONCE per play, at the first following tick: a seek of at
        // most half a beat in the song's first moments, instead of a nudge that takes up to ~8 s.
        let cue: { id: number; beat: number } | undefined;
        if (!song || song.state !== 'running') aligned = false;
        else if (!aligned && inputs.alignStart === true && pace.mode === 'following' && Number.isFinite(pace.phaseError)) {
          aligned = true;
          if (Math.abs(pace.phaseError) > ALIGN_MIN_BEATS) cue = { id: ALIGN_CUE_ID_BASE + ++alignCue, beat: Math.max(0, song.beat - pace.phaseError) };
        }
        return { rate: pace.rate, pace, ...(cue ? { cue } : {}) };
      },
    };
  },
});
