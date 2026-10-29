/**
 * The plane the voice moves a dot on: Pop the Notes (pitch across, loudness up), the Pitch Maze
 * (pitch across, the climb automatic) and the vowel games (the vowel trapezoid). One coordinate
 * system for all of them, x and y in 0..1 with y up, so a target, a cursor and a hit test are the
 * same code whatever the voice is mapped from; and one view model, so one stage draws them all.
 *
 * Pure: geometry and data, no canvas.
 */
import type { Heard } from './listen';
import type { Results } from './view';

/** A point on the plane: x and y in 0..1, y up. */
export interface Point {
  x: number;
  y: number;
}

/** How distance is measured on a plane. */
export interface PlaneMetric {
  /** x is circular (a pitch class: one octave, B next to C): 0 and 1 meet. */
  wrapX: boolean;
  /** The stage's width over its height, so a disc that is round on screen is round to the hit test. */
  aspect: number;
}

/** `b.x - a.x`, the short way round when x wraps. */
export function dxOn(a: number, b: number, wrapX: boolean): number {
  const d = b - a;
  return wrapX ? d - Math.round(d) : d;
}

/** Distance in units of the plane's height. */
export function distanceOn(a: Point, b: Point, m: PlaneMetric): number {
  return Math.hypot(dxOn(a.x, b.x, m.wrapX) * m.aspect, b.y - a.y);
}

/** x wrapped into 0..1. */
export const wrap01 = (x: number): number => x - Math.floor(x);

/** A small seeded generator (mulberry32), so a course is the same for the same seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the voice is: its point, and whether it is sounding now (a dot dims while it is not). */
export interface CursorState extends Point {
  live: boolean;
}

/** What turns a tick of heard audio into the voice's point (a pitch-and-loudness cursor, a vowel cursor). */
export interface PointSource {
  push(heard: Heard, now: number): CursorState | null;
}

/** A target on the plane: a disc to hold the voice in (`r` in units of the height). */
export interface FieldTarget extends Point {
  id: number;
  r: number;
  /** How much of the hold is done, 0..1: the stage shakes it harder as it nears 1. */
  progress: number;
  state: 'live' | 'popped';
  label?: string;
  /** Engine seconds it popped (the burst is drawn from it). */
  poppedAt?: number;
}

/**
 * A segment of the maze's track as the stage needs it: a wall (a bar across with one opening) or
 * a band (a lit strip along one lane), its span as distances AHEAD of the ball (screen heights;
 * negative is behind), so the stage can draw it from above or in perspective.
 */
export interface SegmentView {
  id: number;
  kind: 'wall' | 'band';
  d0: number;
  d1: number;
  /** The opening's (a wall) or the lane's (a band) centre and width, in x units (it may straddle the wrap). */
  gapX: number;
  gapW: number;
  label: string;
  state: 'ahead' | 'inside' | 'passed';
}

/**
 * What is drawn behind the play: columns (a pitch class each, labelled), a polygon (the vowel
 * trapezoid), marks (the vowels on it) and the y axis's name. Data, so the stage needs no game's
 * tables.
 */
export interface Backdrop {
  columns?: readonly { label: string; dark: boolean }[];
  outline?: readonly Point[];
  marks?: readonly (Point & { label: string })[];
  yLabel?: string;
  xLabel?: string;
}

export type FieldGame = 'pop' | 'maze' | 'vowels';

export interface FieldView {
  game: FieldGame;
  title: string;
  phase: 'playing' | 'results';
  /** Engine seconds now. */
  now: number;
  wrapX: boolean;
  backdrop: Backdrop;
  cursor: CursorState | null;
  /** The cursor's recent path, oldest first. */
  trail: Point[];
  targets: FieldTarget[];
  maze?: {
    segments: SegmentView[];
    ball: Point;
    /** A wall is holding the ball. */
    stuck: boolean;
    /** From above, or a road to the horizon. */
    view: 'top' | 'road';
    /** The band levels: points left, and whether the voice is on the band under the ball now (null: no band under it). */
    points?: number;
    onBand?: boolean | null;
    lost?: boolean;
  };
  /** Done so far, of how many, and seconds since the start. */
  score: { done: number; total: number; elapsed: number };
  /** One line under the title: what to do now. */
  hint?: string;
  results?: Results;
  notice?: string;
}

/** Keep a trail to its last `keepS` seconds (points stamped with the tick's time). */
export function pushTrail(trail: (Point & { t: number })[], p: Point | null, t: number, keepS: number): void {
  if (p) trail.push({ x: p.x, y: p.y, t });
  while (trail.length > 0 && trail[0].t < t - keepS) trail.shift();
}
