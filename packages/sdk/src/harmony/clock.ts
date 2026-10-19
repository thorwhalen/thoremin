/**
 * Musical time for the harmonic instruments (H9 of #613, `docs/design/harmonic-layers.md` §2.6):
 * where a chord instrument's beat comes from, and committing a change on it.
 *
 * - `beatAt`: the beat now from a musical-time stream (the song's `songTime`: a beat at a time and
 *   a tempo), extrapolated to this tick while it runs; anything else (a song loaded but not
 *   playing, paused, ended, a conductor waiting) is no clock, and the instrument counts its own
 *   tempo on from where the music left it. A conductor's fermata, which should hold rather than
 *   fall back, is the conductor clock's to decide when that clock arrives.
 * - `createBeatQuantizer`: a value (the chord a hand holds) that changes only on a beat: a change
 *   made just after a beat (within `grace` beats of one, a player's slightly late hit) takes that
 *   beat at once; otherwise it waits for the next step boundary. A change undone before its beat
 *   never sounds, and a beat that jumps back (a seek, a song restarted, a clock switched) re-aims
 *   the wait at the next boundary from where the beat is. This is the held chord's answer to the camera's delay (#610 item 3): the change
 *   is heard where the music wants it rather than when the frame arrived.
 *
 * Pure.
 */

export const CLOCKS = ['tempo', 'song'] as const;
export type ClockId = (typeof CLOCKS)[number];

/** The fields of a musical-time stream this reads (`MusicalTime` has them all). */
export interface BeatSource {
  /** Engine seconds the reading is for. */
  t: number;
  /** The beat at `t`. */
  beat: number;
  /** Beats per minute. */
  tempo: number;
  state: 'ready' | 'running' | 'hold' | string;
}

/** The beat at `now` (null: no stream, or it is waiting for its first beat). */
export function beatAt(time: BeatSource | null | undefined, now: number): number | null {
  if (!time || !Number.isFinite(time.beat)) return null;
  if (time.state === 'running' && Number.isFinite(time.tempo) && time.tempo > 0) return time.beat + ((now - time.t) * time.tempo) / 60;
  return null;
}

/** A beat this close ahead is reached (a beat count is a float sum of ticks). */
const EPS = 1e-6;

export interface BeatQuantizer<T> {
  /** One tick: the value wanted now and the beat at the end of this tick; the value in force. */
  push(want: T, beat: number, beats: number): T;
  /** The value waiting for its beat (undefined: none). */
  pending(): T | undefined;
  reset(value: T): void;
}

export function createBeatQuantizer<T>(initial: T, { grace = 0.12 }: { grace?: number } = {}): BeatQuantizer<T> {
  let current = initial;
  let waiting: { value: T; at: number } | null = null;
  return {
    push(want, beat, beats) {
      const step = beats > 0 ? beats : 1;
      if (want === current) {
        waiting = null;
        return current;
      }
      const next = (Math.floor((beat + EPS) / step) + 1) * step;
      // A target more than a step ahead means the beat went back: aim at the next boundary again.
      if (waiting && waiting.at > next) waiting = { value: waiting.value, at: next };
      if (!waiting || waiting.value !== want) {
        const into = beat - Math.floor((beat + EPS) / step) * step;
        // Just after a beat: that beat. Else the next step boundary (kept if the wish changes again).
        const at = into <= grace ? beat : waiting ? waiting.at : next;
        waiting = { value: want, at };
      }
      if (beat + EPS >= waiting.at) {
        current = waiting.value;
        waiting = null;
      }
      return current;
    },
    pending: () => waiting?.value,
    reset(value) {
      current = value;
      waiting = null;
    },
  };
}
