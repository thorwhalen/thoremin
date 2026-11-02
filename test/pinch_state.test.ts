/**
 * The pinch state machine (`@thoremin/sdk/gesture/pinch`, #815) on synthetic pinch sequences at
 * 30 fps: the issue's acceptance in synthetic form (one down/up pair per intended pinch, tight or
 * loose, through a short dropout; the latched anchor from ~100 ms before detection; two hands
 * independent) and one test per rule (hysteresis, debounce, grace, adaptive exit, look-back to the
 * closing onset, tail trim, strength). Real-footage tuning is #819.
 */
import { describe, it, expect } from 'vitest';
import {
  createPinchState,
  createPinchStates,
  PINCH_DEFAULTS,
  PinchParamsSchema,
  type PinchOutput,
  type PinchParamsInput,
  type PinchReading,
} from '@thoremin/sdk/gesture/pinch';

const FRAME_MS = 1000 / 30;
/** The acceptance's 5 px, on a 640 px wide frame, in frame fractions. */
const ANCHOR_TOLERANCE = 5 / 640;

interface Hand {
  distance: number;
  x: number;
  y: number;
}

/** Seeded uniform noise in [-amp, amp]. */
function noise(seed: number) {
  let s = (seed * 1_000_003 + 12_345) % 2147483647;
  return (amp: number) => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * amp;
}

/** Readings at 30 fps over [0, endMs); `hand` returns null for a frame the tracker lost. */
function take(endMs: number, hand: (t: number) => Hand | null): PinchReading[] {
  const out: PinchReading[] = [];
  for (let i = 0; i * FRAME_MS < endMs; i++) {
    const t = i * FRAME_MS;
    const h = hand(t);
    out.push(h ? { present: true, t, ...h } : { present: false, t });
  }
  return out;
}

function run(readings: PinchReading[], params: PinchParamsInput = {}) {
  const s = createPinchState(params);
  return readings.map((r) => ({ r, o: s.push(r) }));
}

const edges = (rows: { o: PinchOutput }[]) => rows.map((x) => x.o.edge).filter((e) => e !== null);

/**
 * One pinch: open (distance 1.0) until `startMs`, closing linearly to `closed` over `closeMs`,
 * held until `releaseMs`, opening back to 1.0 over `openMs`. `jitter` is added to the distance.
 */
function pinch(o: { startMs: number; closeMs: number; closed: number; releaseMs: number; openMs: number; jitter?: number; seed?: number }) {
  const n = noise(o.seed ?? 1);
  return (t: number): number => {
    let d: number;
    if (t < o.startMs) d = 1;
    else if (t < o.startMs + o.closeMs) d = 1 + ((o.closed - 1) * (t - o.startMs)) / o.closeMs;
    else if (t < o.releaseMs) d = o.closed;
    else if (t < o.releaseMs + o.openMs) d = o.closed + ((1 - o.closed) * (t - o.releaseMs)) / o.openMs;
    else d = 1;
    return d + n(o.jitter ?? 0);
  };
}

const still = (distance: (t: number) => number) => (t: number): Hand => ({ distance: distance(t), x: 0.5, y: 0.5 });

describe('one down/up pair per intended pinch', () => {
  it('a tight pinch with jitter', () => {
    const d = pinch({ startMs: 300, closeMs: 150, closed: 0.1, releaseMs: 1200, openMs: 150, jitter: 0.03 });
    expect(edges(run(take(2000, still(d))))).toEqual(['down', 'up']);
  });

  it('a loose pinch that closes only just under `on`, its jitter crossing it', () => {
    const d = pinch({ startMs: 300, closeMs: 150, closed: 0.6, releaseMs: 1200, openMs: 150, jitter: 0.05, seed: 3 });
    const readings = take(2000, still(d));
    expect(readings.some((r) => r.present && r.distance! > PINCH_DEFAULTS.on && r.t > 500 && r.t < 1200), 'the jitter crosses `on`').toBe(true);
    expect(edges(run(readings))).toEqual(['down', 'up']);
  });

  it('two pinches give two pairs', () => {
    const a = pinch({ startMs: 200, closeMs: 100, closed: 0.2, releaseMs: 700, openMs: 100 });
    const b = pinch({ startMs: 1200, closeMs: 100, closed: 0.2, releaseMs: 1700, openMs: 100 });
    expect(edges(run(take(2200, still((t) => (t < 1000 ? a(t) : b(t))))))).toEqual(['down', 'up', 'down', 'up']);
  });
});

describe('tracking loss', () => {
  const d = pinch({ startMs: 300, closeMs: 100, closed: 0.2, releaseMs: 1500, openMs: 100 });

  it('a 2-frame dropout inside a pinch neither releases nor re-presses, and strength is held', () => {
    const lost = (t: number) => t >= 800 && t < 800 + 2 * FRAME_MS;
    const rows = run(take(2000, (t) => (lost(t) ? null : still(d)(t))));
    expect(rows.filter((x) => !x.r.present)).toHaveLength(2);
    expect(edges(rows)).toEqual(['down', 'up']);
    for (const x of rows.filter((x) => !x.r.present)) {
      expect(x.o.state).toBe('down');
      expect(x.o.strength).toBeGreaterThan(0.9);
    }
  });

  it('so does a gap of frames that never arrived', () => {
    const readings = take(2000, still(d)).filter((r) => !(r.t >= 800 && r.t < 900));
    expect(edges(run(readings))).toEqual(['down', 'up']);
  });

  it('a dropout longer than the grace releases where the hand was last seen, then a new press', () => {
    const lost = (t: number) => t >= 800 && t < 1100;
    const rows = run(take(2000, (t) => (lost(t) ? null : { distance: d(t), x: 0.3 + t / 10000, y: 0.5 })));
    expect(edges(rows)).toEqual(['down', 'up', 'down', 'up']);
    const up = rows.find((x) => x.o.edge === 'up')!;
    const lastSeen = rows.filter((x) => x.r.present && x.r.t < 800).at(-1)!.r;
    expect(up.r.present).toBe(false);
    expect(up.r.t - lastSeen.t).toBeGreaterThan(PINCH_DEFAULTS.lossGraceMs);
    expect(up.r.t - lastSeen.t).toBeLessThanOrEqual(PINCH_DEFAULTS.lossGraceMs + FRAME_MS);
    expect(up.o.anchor).toEqual({ x: lastSeen.x, y: lastSeen.y });
    expect(up.o.trimFrom).toBe(lastSeen.t);
  });

  it('and a longer gap of frames that never arrived releases on the frame that returns', () => {
    const readings = take(2000, still(d)).filter((r) => !(r.t >= 800 && r.t < 1100));
    const rows = run(readings);
    expect(edges(rows)).toEqual(['down', 'up', 'down', 'up']);
    expect(rows.find((x) => x.o.edge === 'up')!.r.t).toBeGreaterThanOrEqual(1100);
  });
});

describe('no chatter', () => {
  it('jitter around `on` presses once and never releases (hysteresis)', () => {
    const n = noise(11);
    const hover = (t: number) => (t < 300 ? 1 : t < 2300 ? PINCH_DEFAULTS.on + n(0.06) : 1);
    const readings = take(2600, still(hover));
    expect(edges(run(readings))).toEqual(['down', 'up']);
    // The rule removed (a band of nothing): the same take chatters.
    expect(edges(run(readings, { off: PINCH_DEFAULTS.on + 1e-6, exitMargin: 0 })).length).toBeGreaterThan(4);
  });

  it('single-frame spikes past `off` inside a pinch do not release (debounce)', () => {
    const d = pinch({ startMs: 300, closeMs: 100, closed: 0.3, releaseMs: 1600, openMs: 100 });
    const spikes = new Set([24, 30, 36]);
    const readings = take(2000, still(d)).map((r, i) => (spikes.has(i) ? { ...r, distance: 1.0 } : r));
    expect(edges(run(readings))).toEqual(['down', 'up']);
    expect(edges(run(readings, { offFrames: 1 })).length).toBeGreaterThan(2);
  });

  it('a grip that relaxes past `off` without opening, in a loose pinch, holds (the adaptive exit)', () => {
    const base = pinch({ startMs: 300, closeMs: 100, closed: 0.6, releaseMs: 1600, openMs: 100, jitter: 0.005 });
    const relaxed = (t: number) => (t >= 900 && t < 1100 ? 0.78 : base(t));
    const readings = take(2000, still(relaxed));
    expect(edges(run(readings))).toEqual(['down', 'up']);
    // The rule removed (release at `off` alone): the relaxed grip releases and re-presses.
    expect(edges(run(readings, { exitMargin: 0 }))).toEqual(['down', 'up', 'down', 'up']);
  });

  it('while a tight pinch still releases at `off`', () => {
    const d = pinch({ startMs: 300, closeMs: 100, closed: 0.2, releaseMs: 1000, openMs: 300 });
    const rows = run(take(1600, still(d)));
    const up = rows.find((x) => x.o.edge === 'up')!;
    const prev = rows[rows.indexOf(up) - 1]!;
    expect(prev.r.distance!).toBeGreaterThan(PINCH_DEFAULTS.off);
    expect(rows[rows.indexOf(up) - 2]!.r.distance!).toBeLessThanOrEqual(PINCH_DEFAULTS.off);
  });
});

describe('the anchors', () => {
  it('the down anchor is the position ~100 ms before detection, while the closing moved the point', () => {
    // A slow pinch (300 ms) drawn while moving right; closing the fingers drags the point down.
    const d = pinch({ startMs: 400, closeMs: 300, closed: 0.3, releaseMs: 1500, openMs: 200 });
    const pos = (t: number) => ({ x: 0.2 + 0.3 * (t / 1000), y: 0.5 + 0.08 * Math.min(1, Math.max(0, (t - 400) / 300)) });
    const rows = run(take(2000, (t) => ({ distance: d(t), ...pos(t) })));
    const down = rows.find((x) => x.o.edge === 'down')!;
    const want = pos(down.r.t - PINCH_DEFAULTS.lookbackMs);
    expect(Math.hypot(down.o.anchor!.x - want.x, down.o.anchor!.y - want.y)).toBeLessThan(ANCHOR_TOLERANCE);
    const atDetection = pos(down.r.t);
    expect(Math.hypot(down.o.anchor!.x - atDetection.x, down.o.anchor!.y - atDetection.y)).toBeGreaterThan(4 * ANCHOR_TOLERANCE);
  });

  it('a pinch snapped shut while drawing anchors at the closing onset, not 100 ms back', () => {
    // The fingers go from open to shut in two frames while the hand moves right at 1 frame width/s.
    const snapAt = 20;
    const rows = run(
      take(1500, (t) => {
        const i = Math.round(t / FRAME_MS);
        const distance = i <= snapAt ? 1 : i === snapAt + 1 ? 0.6 : i < 35 ? 0.2 : 1;
        return { distance, x: 0.1 + t / 1000, y: 0.5 };
      }),
    );
    const down = rows.find((x) => x.o.edge === 'down')!;
    const onset = rows[snapAt]!.r;
    expect(down.o.anchor!.x).toBeCloseTo(onset.x!, 9);
    expect(down.r.t - onset.t).toBeLessThan(PINCH_DEFAULTS.lookbackMs);
  });

  it('the up edge trims the tail back to the last closed frame, at most trimMs, and lifts the pen there', () => {
    const d = pinch({ startMs: 300, closeMs: 100, closed: 0.2, releaseMs: 1000, openMs: 200 });
    const pos = (t: number) => ({ x: 0.5, y: 0.5 - 0.1 * Math.min(1, Math.max(0, (t - 1000) / 200)) });
    const rows = run(take(1600, (t) => ({ distance: d(t), ...pos(t) })));
    const up = rows.find((x) => x.o.edge === 'up')!;
    const lastClosed = rows.filter((x) => x.r.t < up.r.t && x.r.distance! < PINCH_DEFAULTS.on).at(-1)!.r;
    const trimFrom = Math.max(lastClosed.t, up.r.t - PINCH_DEFAULTS.trimMs);
    expect(up.o.trimFrom).toBeCloseTo(trimFrom, 9);
    expect(up.o.trimFrom!).toBeLessThan(up.r.t);
    const want = pos(trimFrom);
    expect(Math.hypot(up.o.anchor!.x - want.x, up.o.anchor!.y - want.y)).toBeLessThan(ANCHOR_TOLERANCE);
    // Not where the opening had moved the point to by the time it was detected.
    expect(Math.abs(up.o.anchor!.y - pos(up.r.t).y)).toBeGreaterThan(4 * ANCHOR_TOLERANCE);
  });
});

describe('two hands', () => {
  it('are independent: one hand losing tracking and pinching does not touch the other', () => {
    const left = take(2000, still(pinch({ startMs: 300, closeMs: 100, closed: 0.2, releaseMs: 1400, openMs: 100 })));
    const right = take(2000, (t) =>
      t >= 500 && t < 900 ? null : still(pinch({ startMs: 200, closeMs: 100, closed: 0.2, releaseMs: 1700, openMs: 100 }))(t),
    );
    const both = createPinchStates();
    const l: PinchOutput[] = [];
    const r: PinchOutput[] = [];
    left.forEach((reading, i) => {
      r.push(both.push('Right', right[i]!));
      l.push(both.push('Left', reading));
    });
    expect(l).toEqual(run(left).map((x) => x.o));
    expect(r).toEqual(run(right).map((x) => x.o));
    expect(l.map((o) => o.edge).filter(Boolean)).toEqual(['down', 'up']);
    expect(r.map((o) => o.edge).filter(Boolean)).toEqual(['down', 'up', 'down', 'up']);
  });
});

describe('strength and params', () => {
  it('strength is hand-features\' pinch map: 1 touching, 0 apart, 0 with no hand', () => {
    const s = createPinchState();
    expect(s.push({ present: true, t: 0, distance: 1.2, x: 0, y: 0 }).strength).toBeCloseTo(0, 9);
    expect(s.push({ present: true, t: 33, distance: 0.725, x: 0, y: 0 }).strength).toBeCloseTo(0.5, 9);
    expect(s.push({ present: true, t: 66, distance: 0.1, x: 0, y: 0 }).strength).toBe(1);
    expect(createPinchState().push({ present: false, t: 0 }).strength).toBe(0);
  });

  it('a band with off at or under on is refused at once', () => {
    expect(() => createPinchState({ on: 0.7, off: 0.7 })).toThrow();
    expect(PinchParamsSchema.parse({})).toEqual(PINCH_DEFAULTS);
  });
});
