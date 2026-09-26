/**
 * The frame-level stroke detector and the limb-to-drum assignment on self-made wrist
 * trajectories: a synthetic drummer whose wrists dip to known targets at known times.
 */
import { describe, expect, it } from 'vitest';
import type { StreamRecord } from '@/dag';
import { BLM, BODY_LANDMARK_COUNT, type BodyFrame } from '@/nodes/domain';
import { fMeasure } from '@/ictus/metrics';
import { assignStrokes, detectStrokes, kmeans, strokesOf, wristTracks } from '../../scripts/air/lib_drum_strokes';
import { rng } from './synthetic_hand';

interface Hit {
  t: number;
  wrist: 'left' | 'right';
  target: { x: number; y: number };
}

/**
 * A pose stream at `fps` with the shoulders fixed and each wrist resting at a home
 * position, dipping to a target with a raised-cosine stroke around each hit time.
 */
function drummer(hits: Hit[], seconds: number, fps: number, opts: { jitter?: number; strokeSeconds?: number; seed?: number } = {}): StreamRecord[] {
  const r = rng(opts.seed ?? 3);
  const jitter = opts.jitter ?? 0.6;
  const dur = opts.strokeSeconds ?? 0.18;
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
          const a = 0.5 * (1 + Math.cos((Math.PI * dt) / (dur / 2))); // 1 at the hit, 0 at the edges
          p = { x: home[w].x + (h.target.x - home[w].x) * a, y: home[w].y + (h.target.y - home[w].y) * a };
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

describe('detectStrokes', () => {
  it('finds every stroke at 30 fps within a frame, and none on a still wrist', () => {
    const hits: Hit[] = [];
    for (let k = 0; k < 12; k++) hits.push({ t: 0.5 + 0.4 * k, wrist: k % 2 ? 'left' : 'right', target: k % 2 ? SNARE : HIHAT });
    const recs = drummer(hits, 6, 30);
    const strokes = strokesOf(recs);
    expect(strokes.length).toBe(12);
    const f = fMeasure(hits.map((h) => h.t), strokes.map((s) => s.t), 1 / 30);
    expect(f).toBeGreaterThan(0.95);
    for (const s of strokes) expect(s.strength).toBeGreaterThan(3);
    const still = detectStrokes(wristTracks(drummer([], 3, 30)).left, 'left');
    expect(still.length).toBe(0);
  });

  it('keeps a refractory gap and interpolates the reversal between frames', () => {
    const hits: Hit[] = [{ t: 1.0133, wrist: 'right', target: SNARE }]; // between frames 30 and 31 at 30 fps
    const strokes = strokesOf(drummer(hits, 2, 30, { jitter: 0 }));
    expect(strokes.length).toBe(1);
    expect(Math.abs(strokes[0].t - 1.0133)).toBeLessThan(1 / 30);
    const quick = strokesOf(drummer([{ t: 1, wrist: 'right', target: SNARE }, { t: 1.03, wrist: 'right', target: SNARE }], 2, 60, { strokeSeconds: 0.06 }), {
      refractorySeconds: 0.08,
    });
    expect(quick.length).toBe(1);
  });
});

describe('assignStrokes', () => {
  it('recovers three drums from where the strokes land, and labels each stroke', () => {
    const hits: Hit[] = [];
    const targets = [SNARE, HIHAT, TOM];
    for (let k = 0; k < 30; k++) hits.push({ t: 0.4 + 0.3 * k, wrist: k % 2 ? 'left' : 'right', target: targets[k % 3] });
    const strokes = strokesOf(drummer(hits, 10, 30));
    const drums = assignStrokes(strokes);
    expect(drums.length).toBe(3);
    expect(drums.reduce((s, c) => s + c.count, 0)).toBe(strokes.length);
    expect(strokes.every((s) => s.drum !== undefined)).toBe(true);
    // Strokes at the same time-slot target share a drum.
    const byTarget = new Map<number, Set<number>>();
    strokes.forEach((s) => {
      const k = Math.round((s.t - 0.4) / 0.3) % 3;
      byTarget.set(k, (byTarget.get(k) ?? new Set()).add(s.drum!));
    });
    for (const set of byTarget.values()) expect(set.size).toBe(1);
  });

  it('finds one drum when every stroke lands in the same place', () => {
    const hits: Hit[] = Array.from({ length: 12 }, (_, k) => ({ t: 0.4 + 0.3 * k, wrist: 'right' as const, target: SNARE }));
    const drums = assignStrokes(strokesOf(drummer(hits, 5, 30)));
    expect(drums.length).toBe(1);
  });
});

describe('kmeans', () => {
  it('separates two obvious groups deterministically', () => {
    const pts = [
      ...Array.from({ length: 10 }, (_, i) => ({ x: i * 0.01, y: 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: 5 + i * 0.01, y: 5 })),
    ];
    const a = kmeans(pts, 2);
    const b = kmeans(pts, 2);
    expect(a.centres.map((c) => c.count)).toEqual([10, 10]);
    expect(a.labels).toEqual(b.labels);
    expect(kmeans([], 2).centres).toEqual([]);
  });
});
