/**
 * The voice as a dot: what the microphone heard, turned into a point on the plane (`field`).
 *
 * Across: the pitch CLASS, one octave that wraps (C at the left, B at the right, and past B the dot
 * comes back in at C), so any voice reaches every column in its own octave. Each semitone owns a
 * column and its centre is the note in tune. Up: the loudness on the player's own range
 * (`loudness`), or nothing for a game that moves the dot up itself (the maze).
 *
 * Steadied by the 1-euro filter (`@thoremin/stats/smooth`), the pitch with its period, so a sung
 * note sits still and a leap is followed at once; a dropout shorter than `holdS` keeps the dot
 * where it was, and a note started after a longer silence jumps there rather than gliding from the
 * last one.
 *
 * Pure: fed what was heard each tick.
 */
import { createOneEuro, type OneEuroOptions } from '@thoremin/stats/smooth';
import { midiOf } from '@thoremin/judge';
import type { CursorState, PointSource } from './field';
import { wrap01 } from './field';
import type { Heard } from './listen';
import type { LoudnessScale } from './loudness';
import { nameOf } from './lesson';
import { smoothedAt, type CursorTuning } from './tuning';

/** Semitones in the octave the x axis spans. */
export const OCTAVE = 12;

/** x of a (fractional) MIDI pitch: its pitch class above `tonic`, a column per semitone, note centres mid-column. */
export const pitchX = (midi: number, tonic = 60): number => wrap01((midi - tonic + 0.5) / OCTAVE);

/** The (fractional) semitone above the tonic an x stands for, 0..12. */
export const semitoneOfX = (x: number): number => wrap01(x) * OCTAVE - 0.5;

/** Pitch classes of the black keys (C = 0). */
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

/** The pitch-class columns, labelled, the black keys dark: the backdrop of the pitch games. */
export function pitchColumns(tonic = 60): { label: string; dark: boolean }[] {
  return Array.from({ length: OCTAVE }, (_, k) => ({ label: nameOf(tonic + k).replace(/-?\d+$/, ''), dark: BLACK_KEYS.has((((tonic + k) % OCTAVE) + OCTAVE) % OCTAVE) }));
}

export interface PitchCursorOptions {
  /** The pitch class at the left edge (MIDI; only its class matters). Default 60, C. */
  tonic?: number;
  /** Frames below this YIN clarity are silence. */
  minClarity?: number;
  /** Loudness for y; without it y stays at `restY`. */
  loudness?: LoudnessScale;
  restY?: number;
  /** A silence shorter than this keeps the dot live, seconds. */
  holdS?: number;
  /** Smoothing of x (in semitones, so its speed reads in semitones per second) and of y. */
  smoothX?: OneEuroOptions;
  smoothY?: OneEuroOptions;
  /** The player's smoothing, 0..1 (`tuning`): scales both filters; 0.5 is the defaults. */
  smoothing?: number;
}

export const PITCH_CURSOR_DEFAULTS = {
  tonic: 60,
  minClarity: 0.5,
  restY: 0.5,
  holdS: 0.2,
  smoothX: { minCutoff: 1.5, beta: 0.02 } as OneEuroOptions,
  smoothY: { minCutoff: 1, beta: 0.5 } as OneEuroOptions,
};

/** The voice's pitch class across and its loudness up. */
export function createPitchCursor(options: PitchCursorOptions = {}): PointSource {
  const o = { ...PITCH_CURSOR_DEFAULTS, ...options };
  let smoothing = o.smoothing;
  const filters = () => [createOneEuro({ ...smoothedAt(o.smoothX, smoothing), period: OCTAVE }), createOneEuro(smoothedAt(o.smoothY, smoothing))];
  let [sx, sy] = filters();
  let last: CursorState | null = null;
  let lastVoiced = -Infinity;
  return {
    tune(t: CursorTuning) {
      if (t.smoothing === undefined || t.smoothing === smoothing) return;
      smoothing = t.smoothing;
      [sx, sy] = filters();
    },
    push(heard: Heard, now: number) {
      for (const p of heard.pitch) {
        if (p.f0 === null || !(p.f0 > 0) || p.clarity < o.minClarity) continue;
        if (p.t - lastVoiced > o.holdS) {
          sx.reset();
          sy.reset();
        }
        lastVoiced = p.t;
        const semis = midiOf(p.f0) - o.tonic;
        const x = wrap01((sx.push(p.t, semis) + 0.5) / OCTAVE);
        const y = o.loudness && p.rms !== undefined ? sy.push(p.t, o.loudness.push(p.t, p.rms)) : o.restY;
        last = { x, y, live: true };
      }
      if (last && now - lastVoiced > o.holdS) last = { ...last, live: false };
      return last;
    },
  };
}
