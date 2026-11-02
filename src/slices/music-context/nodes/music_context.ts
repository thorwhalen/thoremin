/**
 * `music-context` node: the active {@link MusicalContext} read at the music's position, every tick.
 *
 * The position comes from the clock that plays the timeline (`ActiveContext.clock`): the song
 * player's `songTime`, or the conductor's `time` for a conducted score. A song's reading carries
 * its song position, which is the song seconds; a conductor's beat, extrapolated to this tick while
 * it runs, is mapped to song seconds through the timeline's ruler (`positionOf`). Paused or held,
 * the position stays; with no clock (nothing playing yet) it is the start.
 *
 * Out:
 * - `scale`: while the dial says the instrument's scale follows the music, the key in force at this
 *   tick's position (`ScaleOverride`), for the `music-scale` interposer on the bridge's scale ports
 *   in the same tick; null while the dials own the scale. Nothing is predicted: a clock held just
 *   short of a bar line (a conductor waiting for the downbeat) keeps the old key.
 * - `chord`'s next chord is announced within the look-ahead (`lookAheadBeats`, one beat by
 *   default), with its time, so a consumer can land it on its beat.
 * - `key`, `chord`: the key and chord in force, the chord with the next one and its time.
 * - `expectations`: bar lines, key and chord changes and melody notes within the horizon, each
 *   with its engine time.
 * - `status`: for the panel.
 *
 * Pure apart from the tick's time: the readings are a function of the inputs and `ctx.time`.
 */
import { z } from 'zod';
import { defineNode, type NodeContext } from '@thoremin/dag';
import type { MusicalTime } from '@thoremin/ictus';
import { chordName, type Chord } from '@thoremin/sdk/harmony/chord';
import { keyName } from '@thoremin/sdk/music/theory';
import { beatOfSeconds, chordAt, expectations, keyAt, nextSpan, secondsOfBeat } from '@thoremin/sdk/context/cursor';
import { keyAsScale, type ScaleOverride } from '@thoremin/sdk/context/scale';
import { IDLE_MUSIC_CONTEXT_STATUS, type ActiveContext, type MusicChordReading, type MusicContextStatus, type MusicKeyReading, type TimedExpectation } from '@thoremin/sdk/context/reading';
import type { KeyRegion, MusicalContext } from '@thoremin/sdk/context/schema';
import { DEFAULT_MUSIC_CONTEXT, type MusicContextSettings } from '../schema';

const Params = z.object({});

/** Where the music is: song seconds now, the ruler's beat now (NaN without a ruler), and how fast
 *  it moves (0 = still): in the clock's beats per engine second for a beat-read clock, in song
 *  seconds per engine second for a position-read one. */
export interface MusicPosition {
  s: number;
  beat: number;
  beatsPerSecond: number;
  /** Song seconds per engine second, for a clock read by its position (else undefined). */
  rate?: number;
}

/**
 * The position of `time` at engine time `now`. A stream read off a recording carries its song
 * position (`time.position`) and its rate (0 while paused): that is the song seconds, extrapolated
 * by the rate (a song with no beat grid reports `ready` whether it plays or not, so the rate is what
 * says it moves). Any other stream (a conductor) is placed by its beat, extrapolated at its tempo
 * while it runs, through the timeline's ruler.
 */
export function positionOf(ctx: MusicalContext, time: MusicalTime | null | undefined, now: number): MusicPosition {
  const ruled = ctx.beats.length >= 2;
  if (time && typeof time.position === 'number' && Number.isFinite(time.position)) {
    const moving = time.state !== 'hold' && (typeof time.rate === 'number' ? time.rate > 0 : time.state === 'running');
    const rate = typeof time.rate === 'number' && time.rate > 0 ? time.rate : 1;
    const s = time.position + (moving ? Math.max(0, now - time.t) * rate : 0);
    const beat = ruled ? beatOfSeconds(ctx, s) : NaN;
    const perBeat = ruled ? secondsOfBeat(ctx, beat + 0.5) - secondsOfBeat(ctx, beat - 0.5) : NaN;
    return { s, beat, beatsPerSecond: moving && perBeat > 0 ? rate / perBeat : 0, rate: moving ? rate : 0 };
  }
  if (!time || !Number.isFinite(time.beat) || !ruled) return { s: 0, beat: NaN, beatsPerSecond: 0 };
  const running = time.state === 'running' && Number.isFinite(time.tempo) && time.tempo > 0;
  const beat = running ? time.beat + (Math.max(0, now - time.t) * time.tempo) / 60 : time.beat;
  return { s: secondsOfBeat(ctx, beat), beat, beatsPerSecond: running ? time.tempo / 60 : 0 };
}

/** The engine time song seconds `t` is reached: by the song position's rate for a position-read
 *  clock, else counted in the ruler's beats at the clock's tempo (exact across the timeline's own
 *  tempo changes); Infinity while the music is still. */
function engineTimeOf(ctx: MusicalContext, pos: MusicPosition, t: number, now: number): number {
  if (pos.rate !== undefined) return pos.rate > 0 ? now + (t - pos.s) / pos.rate : Infinity;
  if (!(pos.beatsPerSecond > 0) || !Number.isFinite(pos.beat)) return Infinity;
  return now + (beatOfSeconds(ctx, t) - pos.beat) / pos.beatsPerSecond;
}

function keyReading(k: KeyRegion): MusicKeyReading {
  const scale = keyAsScale(k);
  const parent = keyName(scale);
  const name = k.mode === 'major' || k.mode === 'minor' ? `${parent} ${k.mode}` : `${chordName({ root: k.tonic, quality: 'maj' }, { tonic: scale.root, scale: scale.type })} ${k.mode}`;
  return { tonic: k.tonic, mode: k.mode, scalePcs: k.scalePcs, name, confidence: k.confidence };
}

const nameIn = (c: Chord, k: KeyRegion | null) => chordName(c, k ? (({ root, type }) => ({ tonic: root, scale: type }))(keyAsScale(k)) : undefined);

export const musicContextNode = defineNode<z.infer<typeof Params>>({
  type: 'music-context',
  roles: ['music', 'control'],
  title: 'Musical context',
  description: 'Reads the music\'s timeline (a score, the player\'s chart) at the playing position: the key and chord in force, the next ones on their beats, and, while the instrument follows the music, its scale.',
  inputs: [
    { name: 'config', kind: 'music-context-config' },
    { name: 'context', kind: 'music-context' },
    { name: 'time', kind: 'musical-time' },
    { name: 'conductorTime', kind: 'musical-time' },
  ],
  outputs: [
    { name: 'scale', kind: 'scale-override' },
    { name: 'key', kind: 'music-key' },
    { name: 'chord', kind: 'music-chord' },
    { name: 'expectations', kind: 'music-expectations' },
    { name: 'status', kind: 'music-context-status' },
  ],
  params: Params,
  make() {
    return {
      process(inputs, ctx: NodeContext) {
        const c: MusicContextSettings = { ...DEFAULT_MUSIC_CONTEXT, ...((inputs.config as Partial<MusicContextSettings> | null | undefined) ?? {}) };
        const active = (inputs.context as ActiveContext | null | undefined) ?? null;
        if (!active) return { scale: null, key: null, chord: null, expectations: [], status: IDLE_MUSIC_CONTEXT_STATUS };
        const now = ctx.time;
        const music = active.context;
        const time = (active.clock === 'conductor' ? inputs.conductorTime : inputs.time) as MusicalTime | null | undefined;
        const pos = positionOf(music, time, now);
        // The look-ahead and the horizon, in song seconds from here.
        const ahead = (beats: number) => (Number.isFinite(pos.beat) && music.beats.length >= 2 ? Math.max(0, secondsOfBeat(music, pos.beat + beats) - pos.s) : 0);
        const lookAheadS = ahead(c.lookAheadBeats);

        const k = keyAt(music, pos.s);
        const owns = c.scaleFrom === 'music' && k !== null;
        const scale: ScaleOverride | null = owns ? { key: { tonic: k.tonic, mode: k.mode }, fit: c.fit } : null;

        const span = chordAt(music, pos.s);
        const nc = nextSpan(music.chords, pos.s);
        const ncAt = nc && nc.start - pos.s <= lookAheadS ? engineTimeOf(music, pos, nc.start, now) : Infinity;
        const chord: MusicChordReading = {
          chord: span?.chord ?? null,
          name: span ? nameIn(span.chord, k) : null,
          confidence: span?.confidence ?? 0,
          next: nc && Number.isFinite(ncAt) ? { chord: nc.chord, name: nameIn(nc.chord, keyAt(music, nc.start)), at: ncAt } : null,
        };

        const coming: TimedExpectation[] = expectations(music, pos.s, ahead(c.horizonBeats)).map((e) => ({ ...e, at: engineTimeOf(music, pos, e.t, now) }));
        const key = k ? keyReading(k) : null;
        const status: MusicContextStatus = {
          active: true,
          source: music.source,
          clock: active.clock,
          moving: pos.rate !== undefined ? pos.rate > 0 : pos.beatsPerSecond > 0,
          position: pos.s,
          key: key?.name ?? null,
          chord: chord.name,
          ownsScale: owns,
        };
        return { scale, key, chord, expectations: coming, status };
      },
    };
  },
});
