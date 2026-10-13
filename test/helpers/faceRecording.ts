/**
 * The real face recording `video_face_expressions` (a resting face, a smile, then a smile with the
 * mouth open) as frames and as a P1 categorizer file (#330). One builder for the P4 play test and
 * the shipped demo shared categorizer (P5, `scripts/faces/build_demo_categorizer.ts`), so the demo
 * is exactly what the tests replay and never a hand-made pretend model.
 */
import { categorizerFromModel, trainModel, type FeatureVector, type PersonalCategorizer } from '@thoremin/sdk/enroll';
import { buildFaceCtx } from '@thoremin/sdk/features/catalog';
import { BLENDSHAPE_NAME_BY_FEATURE, FACE_FEATURES } from '@thoremin/sdk/features/face_catalog';
import type { FaceFrame } from '@thoremin/sdk/nodes/domain';
import { FACE_REST_CUE, FACE_VOCABULARY_CUE } from '@thoremin/ext-faces/lib/take';
import { matrixToHeadPose } from '@/nodes';
import { loadStream } from './fixtures';

export const RECORDING_FPS = 30;
/** The floor of a feature's jitter at rest (a blendshape that does not move at rest). */
const MIN_JITTER = 0.01;

/** The recording's frames as the webcam source emits them: mesh, head pose, blendshapes. */
export function recordedFrames(): FaceFrame[] {
  const marks = loadStream('video_face_expressions', 'face.landmarks') as (FaceFrame & { transformMatrix?: number[] })[];
  const shapes = loadStream('video_face_expressions', 'face.blendshapes') as { present: boolean; blendshapes: Record<string, number> }[];
  return marks.map(({ transformMatrix, ...f }, i) => ({
    ...f,
    blendshapes: shapes[i]?.blendshapes ?? {},
    ...(transformMatrix ? { headPose: matrixToHeadPose(transformMatrix) } : {}),
  }));
}

/** Every face catalog feature of a frame: what the trainer's tap (`faceVec.vector`) records. */
export function vectorOf(frame: FaceFrame): FeatureVector {
  const out: FeatureVector = {};
  if (!frame.present) return out;
  const ctx = buildFaceCtx(frame);
  for (const f of FACE_FEATURES) {
    const v = f.compute(ctx);
    if (Number.isFinite(v)) out[f.id] = v;
  }
  return out;
}

/** The recording's segments (frame ranges): its resting face, a smile, a smile with the mouth open. */
export const SEGMENTS = { rest: [0, 12], smile: [20, 60], open: [66, 96] } as const;

export interface RecordedCategorizerOptions {
  /** The file's name. */
  name?: string;
  /** The two categories' labels (smile, open smile); the trainer's ids when absent. */
  labels?: readonly [string, string];
  /** Keep only the features (default: every blendshape feature). */
  features?: readonly string[];
}

/**
 * The recording saved as P1's categorizer file, in reject mode: the resting frames unclaimed
 * (they are "none of these"), the smile and the open smile one category each, over the
 * blendshape features, each weighted by the inverse of its jitter at rest (noise units, as a
 * session weighs them). Carving the take is the tool's business, tested on its own
 * (`face_session.test.ts`); a recording this short has too few held faces for the still-point
 * sampler, so the categories are its segments.
 */
export function recordedCategorizer(frames: readonly FaceFrame[], options: RecordedCategorizerOptions = {}): PersonalCategorizer {
  const features = [...(options.features ?? Object.keys(BLENDSHAPE_NAME_BY_FEATURE))];
  const range = ([a, b]: readonly [number, number]) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const samples = [
    ...range(SEGMENTS.rest).map((i) => ({ vector: vectorOf(frames[i]), t: (i * 1000) / RECORDING_FPS, cue: FACE_REST_CUE.id })),
    ...[...range(SEGMENTS.smile), ...range(SEGMENTS.open)].map((i) => ({ vector: vectorOf(frames[i]), t: (i * 1000) / RECORDING_FPS, cue: FACE_VOCABULARY_CUE.id })),
  ];
  const rest = samples.filter((x) => x.cue === FACE_REST_CUE.id).map((x) => x.vector);
  const weights = Object.fromEntries(
    features.map((f) => {
      const d = rest.slice(1).map((v, i) => (v[f] ?? 0) - (rest[i][f] ?? 0));
      const sd = Math.sqrt(d.reduce((a, x) => a + x * x, 0) / Math.max(1, d.length));
      return [f, 1 / Math.max(sd, MIN_JITTER)];
    }),
  );
  const nRest = range(SEGMENTS.rest).length;
  const nSmile = range(SEGMENTS.smile).length;
  const clusters = [range([nRest, nRest + nSmile - 1]), range([nRest + nSmile, samples.length - 1])];
  const model = trainModel(samples.map((x) => x.vector), clusters, features, weights, { restVectors: rest });
  const file = categorizerFromModel(model, samples, { name: options.name ?? 'recorded', mode: 'reject', modality: 'face' });
  const labels = options.labels;
  return labels ? { ...file, categories: file.categories.map((c, i) => ({ ...c, label: labels[i] ?? c.label })) } : file;
}
