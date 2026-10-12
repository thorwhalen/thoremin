/**
 * A small dense network, run in plain TypeScript: standardise, then ReLU layers, then a
 * softmax. The shipped ASL models are a few thousand weights, a few microseconds a frame,
 * so no ML runtime (TF.js, ONNX) is worth its download here.
 *
 * The weights arrive as JSON (`thoremin-asl-mlp/1`, written by `scripts/asl/`), checked
 * once by {@link parseMlpModel} so a malformed file fails at load with the reason, never
 * as NaN probabilities a frame later.
 */

export const MLP_FORMAT = 'thoremin-asl-mlp/1';

export interface MlpLayer {
  /** Row-major [out][in]. */
  W: number[][];
  b: number[];
}

export interface MlpModel {
  format: typeof MLP_FORMAT;
  /** What the input vector is (the featuriser's name; see `features.ts` / `motion.ts`). */
  features: string;
  /** Class names, in output order. */
  labels: string[];
  /** Standardisation: x' = (x - mean) / scale. */
  mean: number[];
  scale: number[];
  layers: MlpLayer[];
  /** Extra fields a featuriser needs (window length, etc.). */
  meta?: Record<string, unknown>;
}

export class MlpModelError extends Error {
  constructor(message: string) {
    super(`ASL model: ${message}`);
    this.name = 'MlpModelError';
  }
}

/** Validate a parsed JSON value as an {@link MlpModel}; throws {@link MlpModelError} naming the defect. */
export function parseMlpModel(json: unknown): MlpModel {
  const m = json as Partial<MlpModel> | null;
  if (!m || typeof m !== 'object') throw new MlpModelError('not an object');
  if (m.format !== MLP_FORMAT) throw new MlpModelError(`format is ${String(m.format)}, expected ${MLP_FORMAT}`);
  if (!Array.isArray(m.labels) || !m.labels.length) throw new MlpModelError('no labels');
  if (!Array.isArray(m.mean) || !Array.isArray(m.scale) || m.mean.length !== m.scale.length) throw new MlpModelError('mean/scale missing or of different lengths');
  if (!Array.isArray(m.layers) || !m.layers.length) throw new MlpModelError('no layers');
  let width = m.mean.length;
  m.layers.forEach((l, i) => {
    if (!Array.isArray(l.W) || !Array.isArray(l.b) || l.W.length !== l.b.length) throw new MlpModelError(`layer ${i}: W rows and b differ`);
    if (l.W.some((row) => row.length !== width)) throw new MlpModelError(`layer ${i}: expected ${width} inputs per row`);
    width = l.b.length;
  });
  if (width !== m.labels.length) throw new MlpModelError(`last layer has ${width} outputs for ${m.labels.length} labels`);
  return m as MlpModel;
}

/** Class probabilities for one input vector (length = the model's input width). */
export function mlpPredict(model: MlpModel, x: readonly number[]): number[] {
  let a = x.map((v, i) => (v - model.mean[i]!) / (model.scale[i]! || 1));
  const last = model.layers.length - 1;
  model.layers.forEach((layer, li) => {
    const out = new Array<number>(layer.b.length);
    for (let o = 0; o < layer.b.length; o++) {
      const row = layer.W[o]!;
      let s = layer.b[o]!;
      for (let i = 0; i < row.length; i++) s += row[i]! * a[i]!;
      out[o] = li === last ? s : Math.max(0, s);
    }
    a = out;
  });
  return softmax(a);
}

export function softmax(z: readonly number[]): number[] {
  const mx = Math.max(...z);
  const e = z.map((v) => Math.exp(v - mx));
  const sum = e.reduce((p, c) => p + c, 0);
  return e.map((v) => v / sum);
}
