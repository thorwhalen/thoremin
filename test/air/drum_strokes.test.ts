/**
 * Stroke detection (the ictus detector per wrist) and the per-wrist drum assignment on
 * self-made wrist trajectories: a synthetic drummer whose wrists dip to known targets at
 * known, off-frame times, including a continuous groove where the wrist never rests.
 */
import { describe, expect, it } from 'vitest';
import type { StreamRecord } from '@/dag';
import { BLM, BODY_LANDMARK_COUNT, type BodyFrame } from '@/nodes/domain';
import { fMeasure } from '@/ictus/metrics';
import { assignStrokes, kmeans, median, strokesOf, timingErrors, wristTracks } from '../../scripts/air/lib_drum_strokes';
import { rng } from './synthetic_hand';

interface Hit {
  t: number;
  wrist: 'left' | 'right';
  target: { x: number; y: number };
}

interface DrummerOptions {
  jitter?: number;
  strokeSeconds?: number;
  seed?: number;
  /** Where the wrist lands relative to the target (a wrist is not a stick tip). */
  wristOffset?: { x: number; y: number };
}

/**
 * A pose stream at `fps` with the shoulders fixed and each wrist resting at a home
 * position, dipping to a target with a raised-cosine stroke around each hit time.
 */
function drummer(hits: Hit[], seconds: number, fps: number, opts: DrummerOptions = {}): StreamRecord[] {
  const r = rng(opts.seed ?? 3);
  const jitter = opts.jitter ?? 0.6;
  const dur = opts.strokeSeconds ?? 0.18;
  const off = opts.wristOffset ?? { x: 0, y: 0 };
  const shoulders = { l: { x: 380, y: 200 }, r: { x: 260, y: 200 } };
  const home = { left: { x: 400, y: 320 }, right: { x: 240, y: 320 } };
  const out: StreamRecord[] = [];
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const landmarks = Array.from({ length: BODY_LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0 }));
    const visibility = new Array<number>(BODY_LANDMARK_COUNT).fill(0.95);
    landmarks[BLM.left_shoulder] = { ...shoulders.l, z: 0 };
    landmarks[BLM.right_shoulder] = { ...shoulders.r, z: 0 };
    for (const w of ['left', 'right'] as const) {
      let p = { ...home[w] };
      for (const h of hits) {
        if (h.wrist !== w) continue;
        const dt = t - h.t;
        if (Math.abs(dt) < dur / 2) {
          const a = 0.5 * (1 + Math.cos((Math.PI * dt) / (dur / 2)));
          const tx = h.target.x + off.x;
          const ty = h.target.y + off.y;
          p = { x: home[w].x + (tx - home[w].x) * a, y: home[w].y + (ty - home[w].y) * a };
        }
      }
      p.x += (r() - 0.5) * jitter;
      p.y += (r() - 0.5) * jitter;
      landmarks[w === 'left' ? BLM.left_wrist : BLM.right_wrist] = { ...p, z: 0 };
    }
    const frame: BodyFrame = { width: 640, height: 480, present: true, landmarks, visibility };
    out.push({ tick: i, t, value: frame });
  }
  return out;
}

/** A wrist that never rests: y = home + A(1 - cos 2 pi f t), hits at the troughs. */
function groove(fHz: number, seconds: number, fps: number, amplitude = 40): { records: StreamRecord[]; hits: number[] } {
  const r = rng(9);
  const out: StreamRecord[] = [];
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const landmarks = Array.from({ length: BODY_LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0 }));
    const visibility = new Array<number>(BODY_LANDMARK_COUNT).fill(0.95);
    landmarks[BLM.left_shoulder] = { x: 380, y: 200, z: 0 };
    landmarks[BLM.right_shoulder] = { x: 260, y: 200, z: 0 };
    landmarks[BLM.left_wrist] = { x: 400, y: 320 + (r() - 0.5) * 0.6, z: 0 };
    landmarks[BLM.right_wrist] = { x: 240 + (r() - 0.5) * 0.6, y: 320 + amplitude * (1 - Math.cos(2 * Math.PI * fHz * t)) + (r() - 0.5) * 0.6, z: 0 };
    out.push({ tick: i, t, value: { width: 640, height: 480, present: true, landmarks, visibility } as BodyFrame });
  }
  const hits: number[] = [];
  for (let k = 0; (k + 0.5) / fHz < seconds; k++) hits.push((k + 0.5) / fHz);
  return { records: out, hits };
}

const SNARE = { x: 320, y: 400 };
const HIHAT = { x: 180, y: 380 };
const TOM = { x: 460, y: 390 };

describe('wristTracks', () => {
  it('normalises by the shoulders and honours visibility', () => {
    const recs = drummer([], 0.5, 30);
    const tr = wristTracks(recs);
    expect(tr.left.length).toBe(15);
    expect(tr.left[0].nx).toBeCloseTo((400 - 320) / 120, 1);
    const hidden = recs.map((r) => ({ ...r, value: { ...(r.value as BodyFrame), visibility: (r.value as BodyFrame).visibility.map(() => 0.1) } }));
    expect(wristTracks(hidden).left.every((s) => !s.visible && Number.isNaN(s.nx))).toBe(true);
  });
});

describe('strokesOf (the ictus detector per wrist)', () => {
  it('finds every off-frame stroke at 30 fps to within 5 ms, and none on a still wrist', () => {
    const r = rng(21);
    const hits: Hit[] = [];
    for (let k = 0; k < 14; k++) hits.push({ t: 0.6 + 0.37 * k + r() * 0.02, wrist: k % 2 ? 'left' : 'right', target: k % 2 ? SNARE : HIHAT });
    const strokes = strokesOf(drummer(hits, 7, 30, { jitter: 0.3 }));
    expect(strokes.length).toBe(14);
    const errors = timingErrors(hits.map((h) => h.t), strokes.map((s) => s.t), 1 / 30);
    expect(errors.length).toBe(14);
    expect(Math.max(...errors.map(Math.abs))).toBeLessThan(0.005);
    expect(strokesOf(drummer([], 3, 30)).length).toBe(0);
  });

  it('keeps finding strokes when the wrist never rests (a 2, 4 and 6 Hz groove)', () => {
    for (const f of [2, 4, 6]) {
      const { records, hits } = groove(f, 6, 30);
      const strokes = strokesOf(records).filter((s) => s.wrist === 'right');
      const fm = fMeasure(hits, strokes.map((s) => s.t), 1 / 30);
      expect(fm, `${f} Hz`).toBeGreaterThan(0.9);
    }
  });

  it('reports strokes with the anchor fields and a landing point', () => {
    const strokes = strokesOf(drummer([{ t: 1.0133, wrist: 'right', target: SNARE }], 2, 30, { jitter: 0 }));
    expect(strokes.length).toBe(1);
    const s = strokes[0];
    expect(s.wrist).toBe('right');
    expect(Math.abs(s.t - 1.0133)).toBeLessThan(0.005);
    expect(s.confidence).toBeGreaterThan(0);
    expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
    expect(s.y).toBeGreaterThan(1); // below the shoulders by more than a shoulder width
  });
});

describe('assignStrokes', () => {
  it('recovers three drums per wrist with unequal counts, wrists offset from the drums', () => {
    const hits: Hit[] = [];
    const plan: [{ x: number; y: number }, number][] = [
      [SNARE, 24],
      [HIHAT, 12],
      [TOM, 8], // four strokes per wrist: the smallest cluster a drum may be
    ];
    let t = 0.4;
    for (const [target, n] of plan) for (let k = 0; k < n; k++) hits.push({ t: (t += 0.3), wrist: k % 2 ? 'left' : 'right', target });
    const strokes = strokesOf(drummer(hits, t + 1, 30, { wristOffset: { x: 25, y: -30 } }));
    const drums = assignStrokes(strokes);
    expect(drums.filter((d) => d.wrist === 'left').length).toBe(3);
    expect(drums.filter((d) => d.wrist === 'right').length).toBe(3);
    expect(drums.reduce((s, c) => s + c.count, 0)).toBe(strokes.length);
    const byTargetAndWrist = new Map<string, Set<number>>();
    strokes.forEach((s) => {
      const k = hits.reduce((b, h) => (Math.abs(h.t - s.t) < Math.abs(b.t - s.t) ? h : b)).target;
      const key = `${s.wrist}:${k.x}`;
      byTargetAndWrist.set(key, (byTargetAndWrist.get(key) ?? new Set()).add(s.drum!));
    });
    for (const set of byTargetAndWrist.values()) expect(set.size).toBe(1);
  });

  it('finds one drum when every stroke lands in the same place, and a stray point never becomes one', () => {
    const hits: Hit[] = Array.from({ length: 16 }, (_, k) => ({ t: 0.4 + 0.3 * k, wrist: 'right' as const, target: SNARE }));
    const strokes = strokesOf(drummer(hits, 6, 30));
    expect(assignStrokes(strokes).length).toBe(1);
    strokes[3].x = 4;
    strokes[3].y = -3;
    expect(assignStrokes(strokes).length).toBe(1);
  });

  it('separates a snare from a hi-hat 0.4 shoulder widths apart', () => {
    const near = { x: 320 + 0.4 * 120, y: 400 };
    const hits: Hit[] = Array.from({ length: 24 }, (_, k) => ({ t: 0.4 + 0.3 * k, wrist: 'right' as const, target: k % 2 ? SNARE : near }));
    const drums = assignStrokes(strokesOf(drummer(hits, 8, 30)));
    expect(drums.length).toBe(2);
  });
});

describe('timing helpers', () => {
  it('measures signed errors against the nearest onset within the window', () => {
    expect(timingErrors([1, 2, 3], [1.02, 2.5, 2.98], 0.05)).toEqual([expect.closeTo(0.02, 9), expect.closeTo(-0.02, 9)]);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });
});

describe('kmeans', () => {
  it('separates two obvious groups deterministically and drops empty centres', () => {
    const pts = [...Array.from({ length: 10 }, (_, i) => ({ x: i * 0.01, y: 0 })), ...Array.from({ length: 10 }, (_, i) => ({ x: 5 + i * 0.01, y: 5 }))];
    const a = kmeans(pts, 2);
    const b = kmeans(pts, 2);
    expect(a.centres.map((c) => c.count)).toEqual([10, 10]);
    expect(a.labels).toEqual(b.labels);
    expect(kmeans([], 2).centres).toEqual([]);
    expect(kmeans([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }], 2).centres.length).toBe(1);
  });
});
