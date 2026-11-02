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
import { gestureClassifierNode } from '@/nodes/features/gesture_classifier';
import { handFeaturesNode } from '@/nodes/features/hand_features';

const FPS = 30;
const FRAME_S = 1 / FPS;
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

/** Readings at 30 fps over [0, endS) seconds; `hand` returns null for a frame the tracker lost. */
function take(endS: number, hand: (t: number) => Hand | null): PinchReading[] {
  const out: PinchReading[] = [];
  for (let i = 0; i / FPS < endS; i++) {
    const t = i / FPS;
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
 * One pinch (times in seconds): open (distance 1.0) until `startS`, closing linearly to `closed`
 * over `closeS`, held until `releaseS`, opening back to 1.0 over `openS`. `jitter` is added to the distance.
 */
function pinch(o: { startS: number; closeS: number; closed: number; releaseS: number; openS: number; jitter?: number; seed?: number }) {
  const n = noise(o.seed ?? 1);
  return (t: number): number => {
    let d: number;
    if (t < o.startS) d = 1;
    else if (t < o.startS + o.closeS) d = 1 + ((o.closed - 1) * (t - o.startS)) / o.closeS;
    else if (t < o.releaseS) d = o.closed;
    else if (t < o.releaseS + o.openS) d = o.closed + ((1 - o.closed) * (t - o.releaseS)) / o.openS;
    else d = 1;
    return d + n(o.jitter ?? 0);
  };
}

const still = (distance: (t: number) => number) => (t: number): Hand => ({ distance: distance(t), x: 0.5, y: 0.5 });

describe('one down/up pair per intended pinch', () => {
  it('a tight pinch with jitter', () => {
    const d = pinch({ startS: 0.3, closeS: 0.15, closed: 0.1, releaseS: 1.2, openS: 0.15, jitter: 0.03 });
    expect(edges(run(take(2, still(d))))).toEqual(['down', 'up']);
  });

  it('a loose pinch that closes only just under `on`, its jitter crossing it', () => {
    const d = pinch({ startS: 0.3, closeS: 0.15, closed: 0.6, releaseS: 1.2, openS: 0.15, jitter: 0.05, seed: 3 });
    const readings = take(2, still(d));
    expect(readings.some((r) => r.present && r.distance! > PINCH_DEFAULTS.on && r.t > 0.5 && r.t < 1.2), 'the jitter crosses `on`').toBe(true);
    expect(edges(run(readings))).toEqual(['down', 'up']);
  });

  it('two pinches give two pairs', () => {
    const a = pinch({ startS: 0.2, closeS: 0.1, closed: 0.2, releaseS: 0.7, openS: 0.1 });
    const b = pinch({ startS: 1.2, closeS: 0.1, closed: 0.2, releaseS: 1.7, openS: 0.1 });
    expect(edges(run(take(2.2, still((t) => (t < 1 ? a(t) : b(t))))))).toEqual(['down', 'up', 'down', 'up']);
  });
});

describe('tracking loss', () => {
  const d = pinch({ startS: 0.3, closeS: 0.1, closed: 0.2, releaseS: 1.5, openS: 0.1 });

  it('a 2-frame dropout inside a pinch neither releases nor re-presses, and strength is held', () => {
    const lost = (t: number) => t >= 0.8 && t < 0.8 + 2 * FRAME_S;
    const rows = run(take(2, (t) => (lost(t) ? null : still(d)(t))));
    expect(rows.filter((x) => !x.r.present)).toHaveLength(2);
    expect(edges(rows)).toEqual(['down', 'up']);
    for (const x of rows.filter((x) => !x.r.present)) {
      expect(x.o.state).toBe('down');
      expect(x.o.strength).toBeGreaterThan(0.9);
    }
  });

  it('so does a gap of frames that never arrived', () => {
    const readings = take(2, still(d)).filter((r) => !(r.t >= 0.8 && r.t < 0.9));
    expect(edges(run(readings))).toEqual(['down', 'up']);
  });

  it('a dropout longer than the grace releases where the hand was last seen, then a new press', () => {
    const lost = (t: number) => t >= 0.8 && t < 1.1;
    const rows = run(take(2, (t) => (lost(t) ? null : { distance: d(t), x: 0.3 + t / 10, y: 0.5 })));
    expect(edges(rows)).toEqual(['down', 'up', 'down', 'up']);
    const up = rows.find((x) => x.o.edge === 'up')!;
    const lastSeen = rows.filter((x) => x.r.present && x.r.t < 0.8).at(-1)!.r;
    expect(up.r.present).toBe(false);
    expect(up.r.t - lastSeen.t).toBeGreaterThan(PINCH_DEFAULTS.lossGraceS);
    expect(up.r.t - lastSeen.t).toBeLessThanOrEqual(PINCH_DEFAULTS.lossGraceS + FRAME_S);
    expect(up.o.anchor).toEqual({ x: lastSeen.x, y: lastSeen.y });
    expect(up.o.trimFrom).toBe(lastSeen.t);
  });

  it('and a longer gap of frames that never arrived releases on the frame that returns', () => {
    const readings = take(2, still(d)).filter((r) => !(r.t >= 0.8 && r.t < 1.1));
    const rows = run(readings);
    expect(edges(rows)).toEqual(['down', 'up', 'down', 'up']);
    expect(rows.find((x) => x.o.edge === 'up')!.r.t).toBeGreaterThanOrEqual(1.1);
  });
});

describe('no chatter', () => {
  it('jitter around `on` presses once and never releases (hysteresis)', () => {
    const n = noise(11);
    const hover = (t: number) => (t < 0.3 ? 1 : t < 2.3 ? PINCH_DEFAULTS.on + n(0.06) : 1);
    const readings = take(2.6, still(hover));
    expect(edges(run(readings))).toEqual(['down', 'up']);
    // The rule removed (a band of nothing): the same take chatters.
    expect(edges(run(readings, { off: PINCH_DEFAULTS.on + 1e-6, exitMargin: 0 })).length).toBeGreaterThan(4);
  });

  it('single-frame spikes past `off` inside a pinch do not release (debounce)', () => {
    const d = pinch({ startS: 0.3, closeS: 0.1, closed: 0.3, releaseS: 1.6, openS: 0.1 });
    const spikes = new Set([24, 30, 36]);
    const readings = take(2, still(d)).map((r, i) => (spikes.has(i) ? { ...r, distance: 1.0 } : r));
    expect(edges(run(readings))).toEqual(['down', 'up']);
    expect(edges(run(readings, { offFrames: 1 })).length).toBeGreaterThan(2);
  });

  it('a grip that relaxes past `off` without opening, in a loose pinch, holds (the adaptive exit)', () => {
    const base = pinch({ startS: 0.3, closeS: 0.1, closed: 0.6, releaseS: 1.6, openS: 0.1, jitter: 0.005 });
    const relaxed = (t: number) => (t >= 0.9 && t < 1.1 ? 0.78 : base(t));
    const readings = take(2, still(relaxed));
    expect(edges(run(readings))).toEqual(['down', 'up']);
    // The rule removed (release at `off` alone): the relaxed grip releases and re-presses.
    expect(edges(run(readings, { exitMargin: 0 }))).toEqual(['down', 'up', 'down', 'up']);
  });

  it('while a tight pinch still releases at `off`', () => {
    const d = pinch({ startS: 0.3, closeS: 0.1, closed: 0.2, releaseS: 1, openS: 0.3 });
    const rows = run(take(1.6, still(d)));
    const up = rows.find((x) => x.o.edge === 'up')!;
    const prev = rows[rows.indexOf(up) - 1]!;
    expect(prev.r.distance!).toBeGreaterThan(PINCH_DEFAULTS.off);
    expect(rows[rows.indexOf(up) - 2]!.r.distance!).toBeLessThanOrEqual(PINCH_DEFAULTS.off);
  });
});

describe('the anchors', () => {
  it('the down anchor is the position ~100 ms before detection, while the closing moved the point', () => {
    // A slow pinch (300 ms) drawn while moving right; closing the fingers drags the point down.
    const d = pinch({ startS: 0.4, closeS: 0.3, closed: 0.3, releaseS: 1.5, openS: 0.2 });
    const pos = (t: number) => ({ x: 0.2 + 0.3 * t, y: 0.5 + 0.08 * Math.min(1, Math.max(0, (t - 0.4) / 0.3)) });
    const rows = run(take(2, (t) => ({ distance: d(t), ...pos(t) })));
    const down = rows.find((x) => x.o.edge === 'down')!;
    const want = pos(down.r.t - PINCH_DEFAULTS.lookBackS);
    expect(Math.hypot(down.o.anchor!.x - want.x, down.o.anchor!.y - want.y)).toBeLessThan(ANCHOR_TOLERANCE);
    const atDetection = pos(down.r.t);
    expect(Math.hypot(down.o.anchor!.x - atDetection.x, down.o.anchor!.y - atDetection.y)).toBeGreaterThan(4 * ANCHOR_TOLERANCE);
  });

  it('a pinch snapped shut while drawing anchors at the closing onset, not 100 ms back', () => {
    // The fingers go from open to shut in two frames while the hand moves right at 1 frame width/s.
    const snapAt = 20;
    const rows = run(
      take(1.5, (t) => {
        const i = Math.round(t * FPS);
        const distance = i <= snapAt ? 1 : i === snapAt + 1 ? 0.6 : i < 35 ? 0.2 : 1;
        return { distance, x: 0.1 + t, y: 0.5 };
      }),
    );
    const down = rows.find((x) => x.o.edge === 'down')!;
    const onset = rows[snapAt]!.r;
    expect(down.o.anchor!.x).toBeCloseTo(onset.x!, 9);
    expect(down.r.t - onset.t).toBeLessThan(PINCH_DEFAULTS.lookBackS);
  });

  it('the up edge trims the tail back to the last closed frame, at most trimS, and lifts the pen there', () => {
    const d = pinch({ startS: 0.3, closeS: 0.1, closed: 0.2, releaseS: 1, openS: 0.2 });
    const pos = (t: number) => ({ x: 0.5, y: 0.5 - 0.1 * Math.min(1, Math.max(0, (t - 1) / 0.2)) });
    const rows = run(take(1.6, (t) => ({ distance: d(t), ...pos(t) })));
    const up = rows.find((x) => x.o.edge === 'up')!;
    const lastClosed = rows.filter((x) => x.r.t < up.r.t && x.r.distance! < PINCH_DEFAULTS.on).at(-1)!.r;
    const trimFrom = Math.max(lastClosed.t, up.r.t - PINCH_DEFAULTS.trimS);
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
    const left = take(2, still(pinch({ startS: 0.3, closeS: 0.1, closed: 0.2, releaseS: 1.4, openS: 0.1 })));
    const right = take(2, (t) =>
      t >= 0.5 && t < 0.9 ? null : still(pinch({ startS: 0.2, closeS: 0.1, closed: 0.2, releaseS: 1.7, openS: 0.1 }))(t),
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
    expect(s.push({ present: true, t: 0.033, distance: 0.725, x: 0, y: 0 }).strength).toBeCloseTo(0.5, 9);
    expect(s.push({ present: true, t: 0.066, distance: 0.1, x: 0, y: 0 }).strength).toBe(1);
    expect(createPinchState().push({ present: false, t: 0 }).strength).toBe(0);
  });

  it('a band with off at or under on is refused at once', () => {
    expect(() => createPinchState({ on: 0.7, off: 0.7 })).toThrow();
    expect(PinchParamsSchema.parse({})).toEqual(PINCH_DEFAULTS);
  });
});

/** One present reading. */
const P = (t: number, distance: number, x = 0.5, y = 0.5): PinchReading => ({ present: true, t, distance, x, y });

describe('one observation per camera frame', () => {
  it('a frame pushed twice (60 Hz ticks over a 30 fps camera) counts once toward the debounce', () => {
    // Inside a pinch, ONE camera frame reads fully open: the 2-frame debounce must hold.
    const frames = take(2, (t) => ({ distance: t < 0.3 ? 1 : Math.round(t * FPS) === 30 ? 1.0 : t < 1.6 ? 0.3 : 1, x: 0.5, y: 0.5 }));
    const twice = frames.flatMap((r) => [r, r]);
    expect(edges(run(frames))).toEqual(['down', 'up']);
    expect(edges(run(twice))).toEqual(['down', 'up']);
    // And the repeat is a pure echo: no edge, the previous output's state and strength.
    const rows = run(twice);
    for (let i = 1; i < rows.length; i += 2) {
      expect(rows[i]!.o).toEqual({ state: rows[i - 1]!.o.state, edge: null, strength: rows[i - 1]!.o.strength });
    }
  });

  it('a stamp that steps back is not an observation (no edge, no anchor after the detection)', () => {
    expect(edges(run([P(0, 1), P(0.1, 1), P(0.2, 1), P(0.15, 0.2), P(0.16, 0.2)]))).toEqual([]);
    const rows = run([P(0, 1), P(0.033, 0.2), P(0.066, 0.2), P(0.2, 0.2), P(0.12, 1), P(0.13, 1)]);
    expect(edges(rows)).toEqual(['down']);
    expect(rows.at(-1)!.o.state).toBe('down');
  });
});

describe('the edges of the timing rules', () => {
  it('a fast open: trimFrom is the last closed frame, not t - trimS', () => {
    // Closed through frame k, open from k + 1: `up` is detected at k + 2 (offFrames 2), and
    // t - trimS (3 frames back) would reach before the last closed frame.
    const k = 30;
    const rows = run(take(2, (t) => {
      const i = Math.round(t * FPS);
      return { distance: i < 10 ? 1 : i <= k ? 0.2 : 1, x: 0.2 + t, y: 0.5 };
    }));
    const up = rows.find((x) => x.o.edge === 'up')!;
    const frameK = rows[k]!.r;
    expect(up.r.t).toBe(rows[k + 2]!.r.t);
    expect(up.r.t - PINCH_DEFAULTS.trimS).toBeLessThan(frameK.t);
    expect(up.o.trimFrom).toBe(frameK.t);
    expect(up.o.anchor!.x).toBeCloseTo(frameK.x!, 12);
  });

  it('a gap while up forgets the old positions: the next down anchor is not interpolated toward them', () => {
    // Open at x = 0.1, a 300 ms gap of frames that never arrived, back already closed at x = 0.9.
    const readings = take(2, (t) => ({ distance: t < 0.8 ? 1 : 0.2, x: t < 0.8 ? 0.1 : 0.9, y: 0.5 })).filter((r) => !(r.t >= 0.6 && r.t < 0.9));
    const down = run(readings).find((x) => x.o.edge === 'down')!;
    expect(down.o.anchor).toEqual({ x: 0.9, y: 0.5 });
  });

  it('after a loss detected on a late frame, that frame starts the next debounce', () => {
    const d = pinch({ startS: 0.3, closeS: 0.1, closed: 0.2, releaseS: 1.5, openS: 0.1 });
    const readings = take(2, still(d)).filter((r) => !(r.t >= 0.8 && r.t < 1.1));
    const rows = run(readings);
    const back = rows.findIndex((x) => x.r.t >= 1.1);
    expect(rows[back]!.o.edge).toBe('up');
    expect(rows[back + 1]!.o.edge).toBe('down');
    const slower = run(readings, { onFrames: 3 });
    expect(slower[back + 1]!.o.edge).toBeNull();
    expect(slower[back + 2]!.o.edge).toBe('down');
    // Back open: no streak, no press.
    const open = run(readings.map((r) => (r.t >= 1.1 ? { ...r, distance: 1 } : r)));
    expect(edges(open.slice(back))).toEqual(['up']);
  });

  it('a nominal 150 ms gap on the 60 fps grid does not release by float rounding', () => {
    // (k + 9) / 60 - k / 60 is 0.15000000000000002 for k = 3.
    const k = 3;
    expect((k + 9) / 60 - k / 60).toBeGreaterThan(PINCH_DEFAULTS.lossGraceS);
    const readings: PinchReading[] = [];
    for (let i = 0; i < k + 40; i++) if (i <= k || i > k + 8) readings.push(P(i / 60, i < 2 ? 1 : 0.2));
    expect(readings[k + 1]!.t - readings[k]!.t).toBeGreaterThan(PINCH_DEFAULTS.lossGraceS);
    expect(edges(run(readings))).toEqual(['down']);
  });
});

describe('the adaptive exit is capped', () => {
  it('refuses a margin that would keep a fully open hand pinched', () => {
    expect(() => createPinchState({ exitMargin: 5 })).toThrow(/exitMargin|strengthApart/);
    const largest = PINCH_DEFAULTS.strengthApart - PINCH_DEFAULTS.on - 1e-3;
    const readings = take(2, (t) => ({ distance: t < 0.3 ? 1 : t < 1 ? 0.6 : PINCH_DEFAULTS.strengthApart, x: 0.5, y: 0.5 }));
    expect(edges(run(readings, { exitMargin: largest }))).toEqual(['down', 'up']);
  });
});

describe('the defaults are core\'s', () => {
  it('on, off and the strength map are the gesture classifier\'s pinch thresholds through hand-features\' map', () => {
    const hf = handFeaturesNode.params.parse({});
    const gc = gestureClassifierNode.params.parse({});
    // hand-features: pinch = (pinchApart - distance) / (pinchApart - pinchTouch), so distance = apart - pinch x span.
    const distanceOf = (pinchValue: number) => hf.pinchApart - pinchValue * (hf.pinchApart - hf.pinchTouch);
    expect(PINCH_DEFAULTS.strengthTouch).toBe(hf.pinchTouch);
    expect(PINCH_DEFAULTS.strengthApart).toBe(hf.pinchApart);
    expect(PINCH_DEFAULTS.on).toBeCloseTo(distanceOf(gc.pinchOn), 12);
    expect(PINCH_DEFAULTS.off).toBeCloseTo(distanceOf(gc.pinchOff), 12);
  });
});

describe('pinch params and stamps after the re-review (#815)', () => {
  it('refuses an off at or above strengthApart (a hand opened to apart must release)', () => {
    expect(() => PinchParamsSchema.parse({ on: 0.9, off: 1.3 })).toThrow(/strengthApart/);
  });

  it('a non-finite stamp is no observation and does not silence the machine', () => {
    const m = createPinchState();
    m.push({ present: true, distance: 1.0, x: 0, y: 0, t: 0 });
    m.push({ present: true, distance: 1.0, x: 0, y: 0, t: Infinity });
    const edges: (string | null)[] = [];
    for (let i = 1; i <= 6; i++) edges.push(m.push({ present: true, distance: 0.3, x: 0, y: 0, t: i / 30 }).edge);
    expect(edges).toContain('down');
  });
});
