/**
 * A scripted face carve for the quality tests (#385 E6): rest, smile, an "open smile" that is the
 * smile with the mouth only a little more open (the CLOSE pair, told apart by mouth open), and a
 * distinct surprise; seeded noise, one noise unit = 0.01 in every feature.
 */
import { PersonalCategorizerSchema, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

/** A seeded uniform generator (mulberry32), and a normal from it. */
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

export const SCRIPTED_FEATURES = [
  'face.blendshape.mouth.smileLeft',
  'face.blendshape.mouth.smileRight',
  'face.blendshape.jaw.open',
  'face.geom.mouth.openness',
  'face.blendshape.brow.outerUpLeft',
  'face.blendshape.brow.outerUpRight',
  'face.blendshape.eye.wideLeft',
  'face.blendshape.eye.wideRight',
  'face.blendshape.mouth.pucker',
  'face.blendshape.cheek.puff',
];
/** One noise unit = 0.01 in every feature. */
const W = Object.fromEntries(SCRIPTED_FEATURES.map((f) => [f, 100]));

/** The scripted faces: rest, smile, open smile (the smile with a little more mouth open), surprise. */
const FACES: Record<string, FeatureVector> = {
  rest: {},
  smile: { 'face.blendshape.mouth.smileLeft': 0.6, 'face.blendshape.mouth.smileRight': 0.6, 'face.blendshape.jaw.open': 0.05, 'face.geom.mouth.openness': 0.05 },
  openSmile: { 'face.blendshape.mouth.smileLeft': 0.6, 'face.blendshape.mouth.smileRight': 0.6, 'face.blendshape.jaw.open': 0.13, 'face.geom.mouth.openness': 0.12 },
  surprise: { 'face.blendshape.brow.outerUpLeft': 0.7, 'face.blendshape.brow.outerUpRight': 0.7, 'face.blendshape.eye.wideLeft': 0.5, 'face.blendshape.eye.wideRight': 0.5, 'face.blendshape.jaw.open': 0.4 },
};

/** A categorizer of `holds` per face, each hold the face plus `sd` of noise per feature. */
export function scriptedCarve({ holds = 6, sd = 0.03, seed = 7 } = {}): PersonalCategorizer {
  const n = rng(seed);
  const samples: PersonalCategorizer['samples'] = [];
  const ids: Record<string, string[]> = {};
  for (const [face, centre] of Object.entries(FACES)) {
    ids[face] = [];
    for (let i = 0; i < holds; i++) {
      const id = `${face}:${i}`;
      ids[face].push(id);
      samples.push({ id, t: samples.length * 1000, cue: 'faces-yours', vector: Object.fromEntries(SCRIPTED_FEATURES.map((f) => [f, (centre[f] ?? 0) + sd * n()])) });
    }
  }
  return PersonalCategorizerSchema.parse({
    format: 'thoremin.categorizer',
    version: 3,
    name: 'scripted',
    modality: 'face',
    features: SCRIPTED_FEATURES,
    weights: W,
    strangers: 'neutral',
    rejectRadius: 40,
    samples,
    categories: [
      { id: 'cat-1', label: 'smile', members: ids.smile },
      { id: 'cat-2', label: 'open smile', members: ids.openSmile },
      { id: 'cat-3', label: 'surprise', members: ids.surprise },
    ],
    neutral: ids.rest,
    neutralTrained: true,
  });
}

