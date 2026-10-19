/**
 * A synthetic face for the categorizer session (#330 P2): feature vectors that rest, then hold
 * three expressions in turn with a relaxed face between them, on a timeline. The verification
 * affordance `?carve.source=synthetic` selects it (like `?slot.source=synthetic-hands` for the
 * instrument), so the whole session runs with no camera and no face model: the browser smoke
 * drives it, and a developer can see the grid without making faces.
 *
 * Pure and deterministic (a seeded jitter), so a test can sample it too. The panel pairs it with
 * a canvas video that paints the current expression's name and colour, so the exemplar frames
 * show which expression each category caught.
 */
import { BLENDSHAPE_NAME_BY_FEATURE } from '@thoremin/sdk/features/face_catalog';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

/** One synthetic expression: blendshape weights by blendshape NAME, a colour for its frames. */
export interface SyntheticExpression {
  name: string;
  color: string;
  blendshapes: Readonly<Record<string, number>>;
}

export const SYNTHETIC_EXPRESSIONS: readonly SyntheticExpression[] = [
  { name: 'rest', color: '#334155', blendshapes: {} },
  { name: 'smile', color: '#ca8a04', blendshapes: { mouthSmileLeft: 0.85, mouthSmileRight: 0.85, cheekSquintLeft: 0.45, cheekSquintRight: 0.45 } },
  { name: 'surprise', color: '#0891b2', blendshapes: { browInnerUp: 0.85, browOuterUpLeft: 0.75, browOuterUpRight: 0.75, jawOpen: 0.6, eyeWideLeft: 0.6, eyeWideRight: 0.6 } },
  { name: 'frown', color: '#b91c1c', blendshapes: { browDownLeft: 0.8, browDownRight: 0.8, mouthFrownLeft: 0.6, mouthFrownRight: 0.6, mouthPressLeft: 0.4, mouthPressRight: 0.4 } },
];

export const SYNTHETIC_TIMELINE = {
  /** The opening rest. */
  restMs: 3500,
  /** Each held face (an expression, or the relaxed face between two). */
  holdMs: 1300,
  /** The glide from one face to the next. */
  glideMs: 250,
  /** Frame-to-frame jitter (blendshape units). */
  jitter: 0.012,
} as const;

/** The faces after the opening rest, in turn: each expression, then the relaxed face. */
const CYCLE: readonly number[] = [1, 0, 2, 0, 3, 0];

/** Which expression (index into {@link SYNTHETIC_EXPRESSIONS}) the face is moving to at `ms`
 *  after the start, and how far it has got there (0..1). */
export function syntheticPhase(ms: number): { from: number; to: number; mix: number } {
  const { restMs, holdMs, glideMs } = SYNTHETIC_TIMELINE;
  if (ms < restMs) return { from: 0, to: 0, mix: 1 };
  const span = holdMs + glideMs;
  const step = Math.floor((ms - restMs) / span);
  const into = (ms - restMs) - step * span;
  const to = CYCLE[step % CYCLE.length];
  const from = step === 0 ? 0 : CYCLE[(step - 1) % CYCLE.length];
  return { from, to, mix: Math.min(1, into / glideMs) };
}

/** The expression the face shows at `ms` (the one it is gliding to once past halfway). */
export function syntheticExpressionAt(ms: number): SyntheticExpression {
  const p = syntheticPhase(ms);
  return SYNTHETIC_EXPRESSIONS[p.mix >= 0.5 ? p.to : p.from];
}

/** A deterministic jitter in [-1, 1] for (frame, feature). */
function jitterOf(frame: number, feature: number): number {
  let h = (frame * 73856093) ^ (feature * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** The face's feature vector (catalog ids) at `ms` after the start; `frame` seeds the jitter. */
export function syntheticFaceVector(ms: number, frame: number): FeatureVector {
  const { from, to, mix } = syntheticPhase(ms);
  return blendVector(from, to, mix, frame);
}

/** One expression held (by name, or index into {@link SYNTHETIC_EXPRESSIONS}), with the same
 *  jitter: a scripted face a test drives on its own schedule (#385 E7: the quiz). */
export function syntheticExpressionVector(expression: string | number, frame: number): FeatureVector {
  const i = typeof expression === 'number' ? expression : SYNTHETIC_EXPRESSIONS.findIndex((e) => e.name === expression);
  if (i < 0 || i >= SYNTHETIC_EXPRESSIONS.length) throw new Error(`no synthetic expression "${expression}"`);
  return blendVector(i, i, 1, frame);
}

function blendVector(from: number, to: number, mix: number, frame: number): FeatureVector {
  const a = SYNTHETIC_EXPRESSIONS[from].blendshapes;
  const b = SYNTHETIC_EXPRESSIONS[to].blendshapes;
  const out: FeatureVector = {};
  let f = 0;
  for (const [id, name] of Object.entries(BLENDSHAPE_NAME_BY_FEATURE)) {
    const x = (a[name] ?? 0) * (1 - mix) + (b[name] ?? 0) * mix + SYNTHETIC_TIMELINE.jitter * jitterOf(frame, f++);
    out[id] = Math.min(1, Math.max(0, x + 0.05));
  }
  return out;
}
