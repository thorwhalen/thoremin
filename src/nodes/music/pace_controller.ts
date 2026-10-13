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
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import { createPaceController, PACE_DEFAULTS, UNKNOWN_PULSE, type MusicalTime, type PaceState, type PulseState } from '@thoremin/ictus';

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
});
type Params = z.infer<typeof Params>;

const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

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
  ],
  outputs: [
    { name: 'rate', kind: 'number', description: 'The rate to play the song at' },
    { name: 'pace', kind: 'pace-state', description: 'What the controller is doing: waiting, locking, following or holding, the ratio, the phase error' },
  ],
  params: Params,
  make(p) {
    const controller = createPaceController(p);
    return {
      process(inputs, ctx) {
        const song = inputs.song as MusicalTime | undefined;
        const base = finite(inputs.base, 1);
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
        return { rate: pace.rate, pace };
      },
    };
  },
});
