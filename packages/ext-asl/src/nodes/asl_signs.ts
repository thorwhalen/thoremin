/**
 * `asl-signs` node: the hands in, an ASL reading out, every tick.
 *
 * Wraps `@thoremin/asl`'s recogniser. The two small models load lazily (the shared
 * `@thoremin/lazy` pattern) the first time the node runs, so a build that never reads signs
 * never downloads their weights. Two outputs carry the same reading: `reading` with the
 * sign ids (what the chord node keys on) and `signs` in the overlay's generic
 * `CategoryScores` shape (short bar labels, the named sign written out).
 */
import { defineNode, type NodeContext } from '@thoremin/dag';
import { lazyResource, withActive, type LoadStatus } from '@thoremin/lazy';
import { frameTime, type CategoryScores, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import {
  createSignRecognizer,
  emptyScores,
  parseMlpModel,
  signShort,
  signText,
  type MlpModel,
  type SignRecognizer,
  type SignScores,
} from '@thoremin/asl';
import { AslDialSchema, DEFAULT_ASL_DIAL, type AslDialParams } from '../schema';

// The params ARE the `asl` dial; the schema lives in `../schema` so the eager stub can carry
// the dial without importing this node (the extension is lazy: docs/design/lazy-extensions.md).
const Params = AslDialSchema;
type Params = AslDialParams;
export { AslDialSchema, DEFAULT_ASL_DIAL, type AslDialParams };

export interface AslModels {
  staticModel: MlpModel;
  motionModel: MlpModel;
}

/** The default loader: the weights as lazily imported JSON chunks. */
export async function loadAslModels(): Promise<AslModels> {
  const [s, m] = await Promise.all([import('@thoremin/asl/models/static.json'), import('@thoremin/asl/models/motion.json')]);
  return { staticModel: parseMlpModel(s.default), motionModel: parseMlpModel(m.default) };
}

/** The reading in the overlay's generic shape. */
export function toCategoryScores(r: SignScores): CategoryScores {
  return {
    present: r.present,
    label: r.label ? signShort(r.label) : null,
    text: r.label ? signText(r.label) : undefined,
    labels: r.labels.map(signShort),
    scores: r.scores,
    title: 'ASL',
  };
}

const ABSENT: CategoryScores = toCategoryScores(emptyScores());

export const aslSignsNode = defineNode<Params>({
  type: 'asl-signs',
  roles: ['feature'],
  title: 'ASL Signs',
  description: 'Hands → ASL signs: the fingerspelled alphabet and a few common words, a score per sign (two small MLPs over the hand landmarks).',
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'config', kind: 'asl-config' },
  ],
  outputs: [
    { name: 'reading', kind: 'asl-reading' },
    { name: 'signs', kind: 'category-scores' },
    { name: 'status', kind: 'load-status' },
  ],
  params: Params,
  make(p) {
    let cfg: Params = p;
    let lastConfigRef: unknown = undefined;
    let recognizer: SignRecognizer | null = null;
    let recognizerKey = '';
    let loader: (() => Promise<AslModels>) | undefined;

    const resource = lazyResource<AslModels>({
      load: async () => ({ resource: await (loader ?? loadAslModels)() }),
      label: 'sign models',
      log: (m) => console.warn(`[thoremin] ${m}`),
    });

    const resolveConfig = (raw: unknown): Params => {
      if (raw === lastConfigRef) return cfg;
      lastConfigRef = raw;
      const parsed = raw && typeof raw === 'object' ? Params.partial().safeParse(raw) : null;
      cfg = parsed?.success ? ({ ...p, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) } as Params) : p;
      return cfg;
    };

    return {
      init(ctx: NodeContext) {
        loader = ctx.resources.loadAslModels as (() => Promise<AslModels>) | undefined;
      },
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        resource.want(c.enabled);
        const models = resource.current();
        if (!c.enabled || !models) {
          recognizer = null;
          const status: LoadStatus = resource.status();
          return { reading: emptyScores(), signs: ABSENT, status };
        }
        // Rebuilt only when the motion model comes or goes; the tuning sliders retune the live
        // recogniser (a drag writes every frame, and a rebuild would wipe the history).
        const key = String(c.motion);
        if (!recognizer || key !== recognizerKey) {
          recognizer = createSignRecognizer(models.staticModel, c.motion ? models.motionModel : null);
          recognizerKey = key;
        }
        recognizer.setOptions({ minConfidence: c.minConfidence, smoothing: c.smoothing });
        const frame = inputs.hands as HandsFrame | undefined;
        // The camera's capture time (#226), so a frame ticked twice is read once and the
        // motion history is spaced as the camera took it.
        const reading = recognizer.update(frame, frameTime(frame, ctx));
        return { reading, signs: toCategoryScores(reading), status: withActive(resource.status(), reading.present, 'Reading signs') };
      },
      dispose() {
        resource.dispose();
      },
    };
  },
});
