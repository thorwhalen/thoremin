/**
 * The physical theremin's physics (`src/slices/theremin/lib/physics.ts`): the heterodyne beat, the
 * capacitance of a hand as plates, the near-field compression, the linearisation, aerial fingering
 * and the volume loop, on hands built in metres (`test/helpers/theremin_hand.ts`).
 */
import { describe, it, expect } from 'vitest';
import { THEREMIN } from '../helpers/extensions';
import {
  DEFAULT_PITCH_CIRCUIT,
  DEFAULT_PLATE_OPTIONS,
  beatFrequency,
  fingerExtension,
  handCapacitance,
  handPlates,
  hzToMidi,
  loopVolume,
  pitchFromCapacitance,
  type Segment,
} from '@/slices/theremin/lib/physics';
import { rawPitchOf, volumeOf } from '@/slices/theremin/nodes/physical_theremin';
import { DEFAULT_PHYSICAL_THEREMIN as S, type PhysicalThereminSettings } from '@/slices/theremin/schema';
import { testHand } from '../helpers/theremin_hand';

const DEFAULT_PLATES_FOR_TEST = { ...DEFAULT_PLATE_OPTIONS, standoff: S.pitch.standoffCm / 100 };

const W = 1280;
const H = 720;
const FRAME = { width: W, height: H, hands: [] };
const PX_PER_M = W / 0.9;
/** The rod's place in the camera frame (the display mirrors it). */
const ROD_PX = (1 - S.pitchAntenna.x) * W;
const at = (d: number, extra: Parameters<typeof testHand>[0] extends infer T ? Partial<T> : never = {}) =>
  testHand({ cx: ROD_PX + d * PX_PER_M, cy: H / 2, pxPerM: PX_PER_M, yaw: Math.PI / 2, ...extra });
const pitchAt = (d: number, s: PhysicalThereminSettings = S, extra = {}) => rawPitchOf(at(d, extra), FRAME as never, s).midi;
const raw = (s: PhysicalThereminSettings = S): PhysicalThereminSettings => ({ ...s, pitch: { ...s.pitch, linearity: 0 } });
const FIST = { curl: { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 } };

describe.runIf(THEREMIN)('the heterodyne beat', () => {
  it('is the zero beat with no hand, and rises with the capacitance', () => {
    expect(beatFrequency(0)).toBeCloseTo(DEFAULT_PITCH_CIRCUIT.nullHz, 6);
    expect(beatFrequency(1e-12)).toBeGreaterThan(beatFrequency(0.5e-12));
  });

  it('is about carrier * C / (2 C_tank) for a small capacitance (LC frequency, 1 / sqrt(LC))', () => {
    const c = 0.2e-12;
    const approx = DEFAULT_PITCH_CIRCUIT.nullHz + (DEFAULT_PITCH_CIRCUIT.carrierHz * c) / (2 * DEFAULT_PITCH_CIRCUIT.tankC);
    expect(beatFrequency(c) / approx).toBeCloseTo(1, 2);
  });

  it('linearity 0 is exactly the raw LC curve', () => {
    for (const c of [0.1e-12, 0.5e-12, 2e-12]) expect(pitchFromCapacitance(c, { linearity: 0 })).toBe(hzToMidi(beatFrequency(c)));
  });
});

describe.runIf(THEREMIN)('a hand at the pitch rod', () => {
  it('a few tenths of a picofarad at arm length, picofarads close by (the order a real theremin sees)', () => {
    const cOf = (d: number) => handCapacitance(handPlates(at(d), FRAME, { x0: S.pitchAntenna.x, y0: S.pitchAntenna.top, x1: S.pitchAntenna.x, y1: S.pitchAntenna.bottom } satisfies Segment, 'x', DEFAULT_PLATES_FOR_TEST), 1);
    expect(cOf(0.5) * 1e12).toBeGreaterThan(0.05);
    expect(cOf(0.5) * 1e12).toBeLessThan(0.5);
    expect(cOf(0.04) * 1e12).toBeGreaterThan(1);
    expect(cOf(0.04) * 1e12).toBeLessThan(15);
  });

  it('the pitch rises monotonically as the hand comes closer', () => {
    const ds = [0.7, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1, 0.06, 0.04];
    for (const s of [raw(), S]) {
      const p = ds.map((d) => pitchAt(d, s));
      for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThan(p[i - 1]);
    }
  });

  it('the raw field is compressed near the rod: a centimetre near is many times the semitones of a centimetre far', () => {
    const near = pitchAt(0.05, raw()) - pitchAt(0.06, raw());
    const far = pitchAt(0.4, raw()) - pitchAt(0.41, raw());
    expect(near / far).toBeGreaterThan(4);
    // About a log law: halving the distance is about the same interval near and far.
    const octaveNear = pitchAt(0.05, raw()) - pitchAt(0.1, raw());
    const octaveFar = pitchAt(0.2, raw()) - pitchAt(0.4, raw());
    expect(Math.abs(octaveNear - octaveFar)).toBeLessThan(3);
  });

  it('linearity evens out the intervals across the field', () => {
    const spread = (s: PhysicalThereminSettings) => {
      const near = pitchAt(0.05, s) - pitchAt(0.15, s);
      const far = pitchAt(0.35, s) - pitchAt(0.45, s);
      return near / far;
    };
    expect(spread(S)).toBeLessThan(spread(raw()));
    expect(spread({ ...S, pitch: { ...S.pitch, linearity: 1 } })).toBeLessThan(spread(S));
  });

  it('aerial fingering: opening the fingers raises the pitch at a fixed hand position', () => {
    for (const d of [0.1, 0.2, 0.35]) {
      const open = pitchAt(d);
      const fist = pitchAt(d, S, FIST);
      expect(open - fist).toBeGreaterThan(2);
      // Each finger on its own raises it too, the index included.
      const indexOnly = pitchAt(d, S, { curl: { thumb: 1, index: 0, middle: 1, ring: 1, pinky: 1 } });
      expect(indexOnly).toBeGreaterThan(fist);
      expect(indexOnly).toBeLessThan(open);
    }
  });

  it('the palm facing the rod couples more of its area than the palm edge-on', () => {
    const rod: Segment = { x0: S.pitchAntenna.x, y0: S.pitchAntenna.top, x1: S.pitchAntenna.x, y1: S.pitchAntenna.bottom };
    const palmArea = (yaw: number) => handPlates(at(0.2, { yaw }), FRAME, rod, 'x', DEFAULT_PLATES_FOR_TEST)[0].area;
    expect(palmArea(Math.PI / 2)).toBeCloseTo(DEFAULT_PLATES_FOR_TEST.areas.palm, 6);
    expect(palmArea(0)).toBeCloseTo(DEFAULT_PLATES_FOR_TEST.areas.palm * DEFAULT_PLATES_FOR_TEST.edgeCoupling, 6);
  });

  it('finger extension reads 1 straight and 0 curled', () => {
    const pts = (curl: number) => at(0.2, { curl: { index: curl } }).worldKeypoints!.map((k) => ({ x: k.x, y: k.y, z: k.z ?? 0 }));
    expect(fingerExtension(pts(0), 'index')).toBeGreaterThan(0.95);
    expect(fingerExtension(pts(1), 'index')).toBeLessThan(0.1);
    expect(fingerExtension(pts(0.5), 'index')).toBeGreaterThan(fingerExtension(pts(1), 'index'));
  });

  it('works without world landmarks (the image points stand in)', () => {
    const h = at(0.2);
    const noWorld = { ...h, worldKeypoints: undefined };
    const a = rawPitchOf(h, FRAME as never, S).midi;
    const b = rawPitchOf(noWorld, FRAME as never, S).midi;
    expect(Number.isFinite(b)).toBe(true);
    expect(Math.abs(a - b)).toBeLessThan(3);
  });
});

describe.runIf(THEREMIN)('the volume loop', () => {
  const loopPx = S.volumeLoop.y * H;
  const over = (h: number) =>
    volumeOf(testHand({ cx: W * 0.75, cy: loopPx - h * PX_PER_M, pxPerM: PX_PER_M, pitch: Math.PI / 2, handedness: 'Right' }), FRAME as never, S).volume;

  it('full with no hand, silent at the loop, louder as the hand rises', () => {
    expect(loopVolume(0)).toBe(1);
    expect(over(0.01)).toBe(0);
    const hs = [0.03, 0.05, 0.1, 0.2, 0.4];
    const v = hs.map(over);
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThan(v[i - 1]);
    expect(v[v.length - 1]).toBeGreaterThan(0.9);
  });

  it('a sharper tuned circuit (higher Q) silences from further away', () => {
    expect(loopVolume(0.5e-12, { tankC: 100e-12, q: 400, floor: 0.25 })).toBeLessThan(loopVolume(0.5e-12, { tankC: 100e-12, q: 100, floor: 0.25 }));
  });
});
