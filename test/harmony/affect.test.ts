/**
 * Valence and arousal as harmonic controls (H7 of #613): the face's valence moves the key to
 * its parallel major or minor, its arousal adds the key's tensions; both are levels with a
 * margin and a dwell, so a passing smile does not modulate. Unit tests, then the recorded face
 * (`video_face_expressions`: neutral, a smile, a smile with the mouth open and the brows up).
 */
import { describe, it, expect } from 'vitest';
import { AFFECT_WEIGHTS, arousalOf, createLevelTracker, createRestBaseline, parallelSpec, valenceOf, VALENCE_LEVELS } from '@thoremin/sdk/harmony/affect';
import { byTension, tensionSteps } from '@thoremin/sdk/harmony/coloration';
import { DEFAULT_CONTROLS, tonesInRegister } from '@thoremin/sdk/harmony/realize';
import { scalePitchClasses, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { ABSENT_FACE, type FaceFeatures } from '@thoremin/sdk/nodes/domain';
import { loadStream } from '../helpers/fixtures';
import { faceFeaturesNode } from '@/nodes/features/face_features';

const face = (f: Partial<FaceFeatures>): FaceFeatures => ({ ...ABSENT_FACE, present: true, ...f });
const C: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };
const scale = (spec: ScaleSpec) => ({ scale: [...scalePitchClasses(spec.root, spec.type)] });

describe('valence and arousal', () => {
  it('reads a smile as positive, a furrow as negative, no face as nothing', () => {
    expect(valenceOf(face({ smile: 0.9 }))).toBeCloseTo(0.9);
    expect(valenceOf(face({ browFurrow: 0.5 }))).toBeCloseTo(-0.5);
    expect(valenceOf(undefined)).toBeNull();
    expect(arousalOf(face({ mouthOpen: 1, browRaise: 1 }))).toBeCloseTo(1);
    expect(arousalOf(face({}))).toBe(0);
    expect(Object.keys(AFFECT_WEIGHTS.valence)).toContain('smile');
  });

  it('changes level only past the margin and after the dwell', () => {
    const t = createLevelTracker({ edges: [-0.3, 0.3], hysteresis: 0.08, dwellS: 1, rest: 1 });
    expect(t.push(0.35, 0)).toBe(1); // inside the margin
    expect(t.push(0.5, 0.1)).toBe(1); // past it, dwelling
    expect(t.push(0.5, 0.6)).toBe(1);
    expect(t.push(0.5, 1.1)).toBe(2); // a second past it: in force
    expect(t.push(0.25, 1.2)).toBe(2); // above the edge less the margin: held
    expect(t.push(0.1, 1.25)).toBe(2); // back below: dwelling again
    expect(t.push(0.1, 2.5)).toBe(1);
    expect(t.push(0.6, 2.75)).toBe(1);
    expect(t.push(0, 3)).toBe(1); // a passing smile never took over
    expect(t.push(null, 3.25)).toBe(1); // no face: the rest
  });

  it('keeps the level in force when the dwell changes', () => {
    const t = createLevelTracker({ edges: [-0.3, 0.3], hysteresis: 0.08, dwellS: 1, rest: 1 });
    t.push(0.9, 0);
    expect(t.push(0.9, 1)).toBe(2);
    t.setDwell(2);
    expect(t.push(0.9, 1.1)).toBe(2);
    expect(t.push(0, 1.2)).toBe(2); // leaving now takes the new dwell
    expect(t.push(0, 3.2)).toBe(1);
  });

  it('moves the key to its parallel major or minor, and leaves one without', () => {
    expect(parallelSpec(C, VALENCE_LEVELS.darker).type).toBe('minor');
    expect(parallelSpec(C, VALENCE_LEVELS.brighter)).toBe(C);
    expect(parallelSpec({ ...C, type: 'minor' }, VALENCE_LEVELS.brighter).type).toBe('major');
    expect(parallelSpec({ ...C, type: 'blues' }, VALENCE_LEVELS.darker).type).toBe('blues');
  });
});

describe('the face from its own rest (#673)', () => {
  const F = (x: Partial<FaceFeatures>): FaceFeatures => face({ mouthOpen: 0.1, browRaise: 0.3, ...x });
  const run = (b: ReturnType<typeof createRestBaseline>, seconds: number, at: (t: number) => FaceFeatures | undefined, t0 = 0) => {
    let out: FaceFeatures | undefined;
    for (let i = 0; i < seconds * 30; i++) out = b.push(at(t0 + i / 30), 1 / 30);
    return out!;
  };

  it('brows that rest high read as nothing; a raise reads above them, held or not', () => {
    const b = createRestBaseline();
    expect(run(b, 3, () => F({ browRaise: 0.6 })).browRaise).toBe(0);
    expect(run(b, 0.2, () => F({ browRaise: 0.95 })).browRaise).toBeCloseTo(0.35, 1);
    expect(run(b, 5, () => F({ browRaise: 0.95 })).browRaise).toBeGreaterThan(0.3); // held five seconds: still raised
  });

  it('one expression never teaches another control\'s rest (raised brows lower a lighting furrow)', () => {
    const b = createRestBaseline();
    const lit = (t: number) => (t > 5 && t < 7 ? F({ browRaise: 0.9, browFurrow: 0.05 }) : F({ browFurrow: 0.55 }));
    const after = run(b, 20, lit);
    expect(after.browFurrow).toBe(0); // the resting furrow still reads as rest: no minor key at rest
    expect(valenceOf(after)).toBeCloseTo(0, 5);
  });

  it('a glitch frame moves nothing, and the first half-second after the face is found reads as calm', () => {
    const b = createRestBaseline();
    run(b, 5, (t) => (Math.abs(t - 2.5) < 0.02 ? F({ browRaise: 0.05, mouthOpen: 0 }) : F({ browRaise: 0.45 })));
    expect(arousalOf(run(b, 1, () => F({ browRaise: 0.45 })))).toBe(0);
    const fresh = createRestBaseline();
    expect(fresh.push(F({ smile: 0.9 }), 1 / 30)!.smile).toBe(0); // settling
    expect(fresh.push(undefined, 1 / 30)).toBeUndefined();
  });
});

describe('the byTension coloration', () => {
  const color = (notes: number[], tension: number, spec = C) => byTension.color(tonesInRegister(notes), { ...DEFAULT_CONTROLS, tension }, scale(spec)).map((t) => t.midi - notes[0]);

  it('adds the seventh, then the ninth, then the eleventh or the thirteenth, from the key', () => {
    expect(tensionSteps(0)).toBe(0);
    expect(color([48, 52, 55], 0)).toEqual([0, 4, 7]);
    expect(color([48, 52, 55], 1 / 3)).toEqual([0, 4, 7, 11]); // Cmaj7
    expect(color([48, 52, 55], 2 / 3)).toEqual([0, 4, 7, 11, 14]); // Cmaj9
    expect(color([48, 52, 55], 1)).toEqual([0, 4, 7, 11, 14, 21]); // Cmaj13: no 11 over a major third
    expect(color([50, 53, 57], 1)).toEqual([0, 3, 7, 10, 14, 17]); // Dm11
  });

  it('skips a ninth the key makes an avoid note, and what stacks above it', () => {
    expect(color([52, 55, 59], 1)).toEqual([0, 3, 7, 10]); // Em7: F is a minor ninth
  });
});

describe('the recorded face', () => {
  const frames = loadStream('video_face_expressions', 'face.blendshapes') as { t?: number; present: boolean; blendshapes: Record<string, number> }[];
  // Through the face-features node the face source composes, with its smoothing (0.3).
  const node = faceFeaturesNode.make(faceFeaturesNode.params.parse({ smoothing: 0.3 }));
  const features = (f: (typeof frames)[number]): FaceFeatures => (node.process({ face: f }, { time: 0, dt: 1 / 24, tick: 0, resources: {} } as never) as { features: FaceFeatures }).features;

  it('read from its own rest, the face at rest again after its expressions reads no arousal and no valence', () => {
    const base = createRestBaseline();
    const neutral = frames.slice(0, 12);
    let last: FaceFeatures | undefined;
    for (const f of [...frames, ...Array.from({ length: 10 }, () => neutral).flat()]) last = base.push(features(f), 1 / 24);
    expect(arousalOf(last)).toBe(0);
    expect(valenceOf(last)).toBeCloseTo(0, 5);
  });

  it('read from its own rest, the resting face reads no arousal and the open-mouthed smile does', () => {
    const base = createRestBaseline();
    const arousal = createLevelTracker({ edges: [0.25, 0.4], hysteresis: 0.05, dwellS: 0.25, rest: 0 });
    const read = frames.map((f, i) => ({ t: i / 24, level: arousal.push(arousalOf(base.push(features(f), 1 / 24)), i / 24) }));
    const at = (t: number) => read.find((r) => r.t >= t)!;
    expect(at(0.4).level).toBe(0);
    expect(at(1.5).level).toBe(0); // a closed smile is calm
    expect(at(3.3).level).toBe(2); // the open-mouthed smile reaches the ninth
  });

  it('turns a minor key major a second into the smile, and adds tensions to the open-mouthed smile only', () => {
    const valence = createLevelTracker({ edges: [-0.3, 0.3], hysteresis: 0.08, dwellS: 1, rest: 1 });
    const arousal = createLevelTracker({ edges: [0.35, 0.55], hysteresis: 0.05, dwellS: 0.25, rest: 0 });
    const read = frames.map((f, i) => {
      const t = i / 24;
      const fx = features(f);
      return { t, mode: parallelSpec({ ...C, type: 'minor' }, valence.push(valenceOf(fx), t)).type, tension: arousal.push(arousalOf(fx), t) };
    });
    const at = (t: number) => read.find((r) => r.t >= t)!;
    expect(at(0.4).mode).toBe('minor'); // neutral: the key
    expect(at(1.2).mode).toBe('minor'); // smiling, not yet a second
    expect(at(2.0).mode).toBe('major');
    expect(at(1.5).tension).toBe(0); // a closed smile is calm
    expect(at(3.3).tension).toBeGreaterThan(0); // mouth open, brows up
    expect(at(0.1).tension).toBe(0);
  });
});
