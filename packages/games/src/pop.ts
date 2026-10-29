/**
 * Pop: balloons on the plane, and the voice's dot pops one by staying on it long enough. Hold a
 * note at the right pitch and loudness (Pop the Notes), or a vowel at the right place on the
 * trapezoid (Vowel Pop): the session neither knows nor cares which, because the dot comes from an
 * injected `PointSource` and the balloons are points with a radius.
 *
 * A few balloons are up at a time; popping one brings the next of the course. A balloon's hold is a
 * `dwell` that drains slowly while the dot is off it, so a wobble costs a little, not everything.
 * Self-paced: the round ends when the course is popped (or at the time limit, when there is one).
 *
 * Pure: fed the engine time and what was heard each tick.
 */
import type { Cue } from './cues';
import { CLICK_MIDI } from './cues';
import { createDwell, type Dwell } from './dwell';
import { distanceOn, pushTrail, seededRandom, type Backdrop, type FieldGame, type FieldTarget, type FieldView, type Point, type PointSource } from './field';
import type { Heard } from './listen';
import { NOTHING_HEARD } from './listen';

/** A balloon of the course: where, how big (units of the height), and its name if it has one. */
export interface PopTarget extends Point {
  r: number;
  label?: string;
}

export interface PopOptions {
  game?: FieldGame;
  title: string;
  start: number;
  targets: readonly PopTarget[];
  cursor: PointSource;
  backdrop: Backdrop;
  wrapX?: boolean;
  /** The stage's width over its height (the hit test's metric). Default 16 / 9. */
  aspect?: number;
  /** Balloons up at once. Default 3. */
  atOnce?: number;
  /** Seconds on a balloon to pop it. Default 1. */
  holdS?: number;
  /** Hold lost per second off it, as a fraction. Default 0.5. */
  decay?: number;
  /** End the round after this long, seconds. Default none. */
  timeLimitS?: number;
  /** The line under the title. */
  hint?: string;
}

export const POP_DEFAULTS = { atOnce: 3, holdS: 1, decay: 0.5, aspect: 16 / 9 };

/** The pop's own sound: a short click far above any voice (the pitch tracker ignores it). */
const POP_CUE = (t: number): Cue => ({ t, midi: CLICK_MIDI, velocity: 0.5, kind: 'click' });

export function createPopSession(opts: PopOptions) {
  const o = { ...POP_DEFAULTS, ...opts };
  const metric = { wrapX: o.wrapX ?? false, aspect: o.aspect };
  const targets: (FieldTarget & { dwell: Dwell })[] = o.targets.map((t, id) => ({ ...t, id, progress: 0, state: 'live', dwell: createDwell({ needS: o.holdS, decay: o.decay }) }));
  const trail: (Point & { t: number })[] = [];
  let shown = Math.min(o.atOnce, targets.length);
  let popped = 0;
  let last = o.start;
  let endedAt: number | null = null;

  function tick(now: number, heard: Heard = NOTHING_HEARD): { view: FieldView; cues: Cue[] } {
    const cues: Cue[] = [];
    const cursor = o.cursor.push(heard, now);
    const dt = Math.max(0, now - last);
    last = now;
    const playing = endedAt === null && now >= o.start;
    if (playing) {
      for (let k = 0; k < shown; k++) {
        const b = targets[k];
        if (b.state === 'popped') continue;
        const inside = !!cursor?.live && distanceOn(cursor, b, metric) <= b.r;
        b.progress = b.dwell.step(inside, dt);
        if (b.dwell.done) {
          b.state = 'popped';
          b.poppedAt = now;
          popped++;
          cues.push(POP_CUE(now));
          if (shown < targets.length) shown++;
        }
      }
      if (popped === targets.length || (o.timeLimitS !== undefined && now - o.start >= o.timeLimitS)) endedAt = now;
    }
    pushTrail(trail, cursor?.live ? cursor : null, now, 0.6);

    const elapsed = Math.max(0, (endedAt ?? now) - o.start);
    const view: FieldView = {
      game: o.game ?? 'pop',
      title: o.title,
      phase: endedAt === null ? 'playing' : 'results',
      now,
      wrapX: metric.wrapX,
      backdrop: o.backdrop,
      cursor,
      trail: trail.map(({ x, y }) => ({ x, y })),
      // The live ones, and the popped ones while their burst is still in the air.
      targets: targets.slice(0, shown).filter((b) => b.state === 'live' || now - (b.poppedAt ?? now) < 0.6).map(({ dwell: _d, ...b }) => ({ ...b })),
      score: { done: popped, total: targets.length, elapsed },
      ...(o.hint ? { hint: o.hint } : {}),
      ...(endedAt === null
        ? {}
        : {
            results: {
              accuracy: popped / targets.length,
              counts: { popped, missed: targets.length - popped },
              summary: `${popped} of ${targets.length} popped in ${Math.round(elapsed)} s`,
            },
          }),
    };
    return { view, cues };
  }
  return { tick };
}

/** How hard Pop the Notes is: balloon sizes (units of the height) and the hold. */
export const POP_LEVELS = {
  easy: { rMin: 0.09, rMax: 0.13, holdS: 0.7 },
  normal: { rMin: 0.06, rMax: 0.1, holdS: 1 },
  hard: { rMin: 0.04, rMax: 0.065, holdS: 1.4 },
} as const;

/**
 * A course of pitch-and-loudness balloons: each centred on a semitone's column, at a height the
 * loudness scale reaches (`yMin..yMax`), sizes mixed, never twice in a row on the same column.
 */
export function pitchLoudnessCourse(opts: { count: number; rMin: number; rMax: number; seed?: number; yMin?: number; yMax?: number }): PopTarget[] {
  const rand = seededRandom(opts.seed ?? 1);
  const yMin = opts.yMin ?? 0.15;
  const yMax = opts.yMax ?? 0.85;
  const out: PopTarget[] = [];
  let lastCol = -1;
  for (let k = 0; k < opts.count; k++) {
    let col = Math.floor(rand() * 12);
    if (col === lastCol) col = (col + 1 + Math.floor(rand() * 11)) % 12;
    lastCol = col;
    out.push({ x: (col + 0.5) / 12, y: yMin + rand() * (yMax - yMin), r: opts.rMin + rand() * (opts.rMax - opts.rMin) });
  }
  return out;
}
