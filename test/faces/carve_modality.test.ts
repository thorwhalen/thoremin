/**
 * The carve modality seam (#385 E1): the face read through `faceModality` is the face ext-faces
 * read before the seam (the same cues, the same "is a face in view", the same kept keys, the same
 * names, the same import refusals), and the modules the hands and body will share read no face
 * module directly, so a second modality is an argument, not a fork.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CueSchema } from '@thoremin/sdk/enroll/cue';
import { foreignModality, isNeutralLabel, keepOnly } from '@thoremin/sdk/enroll/modality';
import { FACE_OMIT, FACE_TRAINING_GROUPS } from '@thoremin/sdk/features/face_groups';
import { generalFaceLabeling } from '@thoremin/sdk/features/face_labels';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { carveOwners } from '@thoremin/sdk-ui/enroll/modality';
import { FACE_REST_CUE, FACE_VOCABULARY_CUE } from '@thoremin/ext-faces/lib/take';
import { fallbackName, NEUTRAL_LABEL } from '@thoremin/ext-faces/lib/carving';
import { DISTANCE_PROXIES } from '@thoremin/sdk/enroll/live';
import { FACES_CLAIMER, FACES_TEST_CLAIMER } from '@thoremin/ext-faces/app/faceSession';

const EXT = join(__dirname, '../../packages/ext-faces/src');

describe('the seam: shared modules read no face module directly', () => {
  // The modules a hand or body carve will run through unchanged.
  const SHARED = ['app/sessionStore.ts', 'app/testStore.ts', 'app/faceSession.ts', 'lib/take.ts', 'lib/carving.ts', '../../sdk/src/enroll/live.ts', 'lib/corrections.ts'];
  for (const file of SHARED) {
    it(`${file} imports no features/face_* module`, () => {
      const src = readFileSync(join(EXT, file), 'utf8');
      // Static (`from '…'`, `import type`), side-effect (`import '…'`) and dynamic (`import('…')`), either quote.
      const specifiers = [...src.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(specifiers.length).toBeGreaterThan(0);
      expect(specifiers.filter((s) => /features\/face_/.test(s))).toEqual([]);
    });
  }
});

describe('faceModality is the face as ext-faces read it before the seam', () => {
  it('builds the same cues, word for word', () => {
    // The literals the take declared before #385 E1.
    expect(FACE_REST_CUE).toEqual(
      CueSchema.parse({
        id: 'faces-rest',
        name: 'Rest',
        instruction: 'Look at the camera and relax your face.',
        rationale: 'Sets what "nothing" looks like, and how much your face wanders when you are not asking for anything.',
        collects: { groups: [...FACE_TRAINING_GROUPS], omit: [...FACE_OMIT] },
        produces: 'baseline',
        sufficiency: { kind: 'frames', minFrames: 60 },
        tags: ['face', 'setup'],
      }),
    );
    expect(FACE_VOCABULARY_CUE).toEqual(
      CueSchema.parse({
        id: 'faces-yours',
        name: 'Your faces',
        instruction: 'Make each face you want the instrument to know. Hold each one for a moment, and relax in between.',
        rationale: 'These become your categories. You choose how many afterwards, so do not count as you go.',
        collects: { groups: [...FACE_TRAINING_GROUPS], omit: [...FACE_OMIT] },
        produces: 'vocabulary',
        sufficiency: { kind: 'variety', minPoints: 6 },
        tags: ['face', 'expression'],
      }),
    );
  });

  it('sees a face exactly when a face.* key is finite, and keeps only face.* keys', () => {
    const hasFace = (v: Record<string, number>) => Object.keys(v).some((k) => k.startsWith('face.') && Number.isFinite(v[k]));
    const cases: Record<string, number>[] = [
      {},
      { 'hand.right.index.curl': 0.4 },
      { 'face.blendshape.mouthSmileLeft': Number.NaN, 'body.angle.x': 1 },
      { 'face.blendshape.mouthSmileLeft': 0.2, 'hand.left.x': 0.1 },
      { 'face.head.scale': 0.3, 'face.geom.jaw.thrust': Number.NaN },
    ];
    for (const v of cases) {
      expect(faceModality.read(v) !== null).toBe(hasFace(v));
      const kept = Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith('face.')));
      expect(keepOnly(faceModality, v)).toEqual(kept);
      if (hasFace(v)) expect(faceModality.read(v)).toEqual(kept);
    }
  });

  it('keeps the names, the distance proxies and the claim owners', () => {
    expect(NEUTRAL_LABEL).toBe('neutral');
    expect([0, 2, 6].map(fallbackName)).toEqual(['expression 1', 'expression 3', 'expression 7']);
    expect(isNeutralLabel(faceModality, '  Neutral ')).toBe(true);
    expect(DISTANCE_PROXIES).toEqual(['face.head.scale', 'face.head.distanceProxy']);
    expect([FACES_CLAIMER, FACES_TEST_CLAIMER]).toEqual(['faces', 'faces-test']);
    expect(carveOwners(faceModality)).toEqual({ carve: 'faces', test: 'faces-test' });
    expect(faceModality.groups).toEqual(FACE_TRAINING_GROUPS);
  });

  it('proposes names with the general face model', () => {
    const general = faceModality.general!();
    const reference = generalFaceLabeling();
    expect(general.labels).toEqual(reference.labels);
    expect(general.minScore).toEqual(reference.minScore);
    const centroid = { 'face.blendshape.mouthSmileLeft': 0.8, 'face.blendshape.mouthSmileRight': 0.8 };
    const cat = { id: 'c', label: '', centroid };
    expect(general.score(centroid, cat)).toEqual(reference.score(centroid));
  });

  it('refuses the same files with the same words', () => {
    const face = ['face.blendshape.mouthSmileLeft'];
    expect(foreignModality(faceModality, { features: face })).toBeNull();
    expect(foreignModality(faceModality, { modality: 'face', features: face })).toBeNull();
    expect(foreignModality(faceModality, { modality: 'hand', features: face })).toBe('a hand categorizer, not a face one');
    expect(foreignModality(faceModality, { features: ['hand.right.index.curl'] })).toBe('a non-face categorizer, not a face one');
  });
});
