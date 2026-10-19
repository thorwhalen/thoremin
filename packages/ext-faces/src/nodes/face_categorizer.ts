/**
 * `face-categorizer` node (#330 P4): a player's own face categorizer, read live, as the face
 * chords' classifier. It stands where the general model's reading went (the `face-categorizer`
 * branch replaces core's `face-chord`) and emits the same `face-expression` kind, so the chord
 * renderer and the overlay's expression bars take it unchanged: `label` is the expression the
 * settled category stands in for, `personal` the player's categories (`../lib/play.ts`).
 *
 * The model is a TRANSIENT (`faceCategorizerModel`): the host resolves the instrument's
 * categorizer id to a saved record off the tick and hands the derived live model in, the air
 * vocabularies' precedent. The node never awaits anything. Until that model is there, and
 * whenever it is not the one the dial names (a switch in flight, a categorizer this device
 * does not have), it passes the general model's reading through: the instrument always plays.
 *
 * The face vector is computed here from the face frame, for the model's own features (and the
 * distance proxy its tuning reads): the same catalog values the trainer's tap records, with no
 * feature-demand claim and no dependency on what the Feature Lab shows.
 *
 * Rejection: a face beyond the reject radius for a moment (the tracker's exit hysteresis) is
 * "none of these", which plays what `neutral` plays (silence by default), like a resting face
 * on the general model. `holdOnReject` keeps the last category instead.
 */
import { z } from 'zod';
import { defineNode, type NodeContext } from '@thoremin/dag';
import type { FaceFrame } from '@thoremin/sdk/nodes/domain';
import { buildFaceCtx } from '@thoremin/sdk/features/catalog';
import { FACE_FEATURES } from '@thoremin/sdk/features/face_catalog';
import { createCategoryTracker, type CategoryTracker } from '@thoremin/sdk/enroll/classify';
import { hasReading } from '@thoremin/sdk/enroll/bind';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { ABSENT_EXPRESSION, type ExpressionScores } from '@thoremin/sdk/music/expression';
import { DISTANCE_PROXIES, LIVE_DEFAULTS, tuneVector } from '@thoremin/sdk/enroll/live';
import { absentReading, toExpressionScores, type FaceCategorizerPlay } from '../lib/play';
import { ownDegrees, ownTargets, type FaceCategorizerDial } from '../schema';

const Params = z.object({
  /** Keep the last category while the face is none of these (else play what neutral plays). */
  holdOnReject: z.boolean().default(false),
  /** Frames a new category must win before it sounds. */
  enterFrames: z.number().int().min(1).max(30).default(LIVE_DEFAULTS.enterFrames),
  /** Frames of "none of these" before the category is let go. */
  exitFrames: z.number().int().min(1).max(60).default(LIVE_DEFAULTS.exitFrames),
  /** The share of the model's features a frame must carry to be read at all. */
  minPresent: z.number().min(0).max(1).default(0.9),
});
type Params = z.infer<typeof Params>;

const FEATURE_BY_ID = new Map(FACE_FEATURES.map((f) => [f.id, f]));

/** The catalog features a model reads, plus the distance proxies its tuning may use. */
function featuresFor(play: FaceCategorizerPlay) {
  const ids = new Set<string>([...play.live.model.features, ...DISTANCE_PROXIES]);
  return [...ids].map((id) => FEATURE_BY_ID.get(id)).filter((f): f is NonNullable<typeof f> => !!f);
}

export const faceCategorizerNode = defineNode<Params>({
  type: 'face-categorizer',
  roles: ['feature'],
  title: 'Face Categorizer',
  description:
    'Your own face categorizer (#330), read live: the face to one of your categories, as the expression it stands in for. Passes the general model through until it is loaded.',
  inputs: [
    { name: 'face', kind: 'face-frame' },
    // The general model's reading: what plays until the personal model is there.
    { name: 'general', kind: 'face-expression' },
    // The resolved categorizer (a transient the host sets off the tick), or null.
    { name: 'model', kind: 'face-categorizer-model' },
    // The instrument's dial: which categorizer it names, and each category's degree.
    { name: 'config', kind: 'face-categorizer-config' },
  ],
  outputs: [
    { name: 'expression', kind: 'face-expression' },
    // The player's own degree per category id (no entry: the stand-in's degree).
    { name: 'degrees', kind: 'category-degrees' },
    // The player's own target per category id (H6 of #613; no entry: its degree).
    { name: 'targets', kind: 'category-targets' },
  ],
  params: Params,
  make(p) {
    let current: FaceCategorizerPlay | null = null;
    let tracker: CategoryTracker | null = null;
    let features: ReturnType<typeof featuresFor> = [];
    // The engine ticks faster than the camera: a face frame seen already is not a new reading
    // (the tracker's hysteresis counts camera frames, as the tool's test readout does).
    let lastFrame: FaceFrame | undefined;
    let lastExpression: ExpressionScores = ABSENT_EXPRESSION;

    const bind = (play: FaceCategorizerPlay | null): void => {
      if (play === current) return;
      current = play;
      lastFrame = undefined;
      lastExpression = play ? absentReading(play) : ABSENT_EXPRESSION;
      tracker = play
        ? createCategoryTracker(play.live.model, {
            temperature: play.live.temperature,
            enterFrames: p.enterFrames,
            exitFrames: p.exitFrames,
            holdOnReject: p.holdOnReject,
          })
        : null;
      features = play ? featuresFor(play) : [];
    };

    /** One camera frame read by the current model: absent without a face or its features. */
    const read = (frame: FaceFrame | undefined): ExpressionScores => {
      if (!current || !tracker) return ABSENT_EXPRESSION;
      if (!frame || !frame.present) return absentReading(current);
      const fctx = buildFaceCtx(frame);
      const vector: FeatureVector = {};
      for (const f of features) {
        const v = f.compute(fctx);
        if (Number.isFinite(v)) vector[f.id] = v;
      }
      if (!hasReading(current.live.model, vector, p.minPresent)) return absentReading(current);
      return toExpressionScores(current, tracker.push(tuneVector(current.live, vector)));
    };

    return {
      process(inputs, _ctx: NodeContext) {
        const config = inputs.config as Partial<FaceCategorizerDial> | undefined;
        const model = (inputs.model as FaceCategorizerPlay | null | undefined) ?? null;
        const degrees = ownDegrees(config);
        const targets = ownTargets(config);
        // Only the model the dial names plays: a stale one (a switch in flight) never does.
        bind(model && config?.id === model.id ? model : null);
        if (!current || !tracker) {
          const general = (inputs.general as ExpressionScores | undefined) ?? ABSENT_EXPRESSION;
          return { expression: general, degrees, targets };
        }
        const frame = inputs.face as FaceFrame | undefined;
        if (!frame || frame !== lastFrame) {
          lastFrame = frame;
          lastExpression = read(frame);
        }
        return { expression: lastExpression, degrees, targets };
      },
    };
  },
});
