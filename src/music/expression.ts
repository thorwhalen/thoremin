/**
 * Facial-expression classification + the confusion-aware expression→chord map.
 *
 * Two pure, dependency-free pieces (no DOM, no MediaPipe, no Tonal), so both are
 * trivially unit-testable and reusable by the DAG nodes:
 *
 *  1. {@link blendshapesToExpression} — turn the 52 MediaPipe/ARKit blendshapes
 *     into a softmax distribution over seven canonical expressions via cosine
 *     similarity to FACS-grounded prototype vectors. No second model, no extra
 *     bytes: it reuses the blendshapes the FaceLandmarker already emits.
 *
 *  2. {@link optimalExpressionToDegree} + {@link RECOMMENDED_EXPRESSION_TO_DEGREE} —
 *     the *confusion-aware* assignment of the seven expressions to the seven
 *     scale degrees. Expression pairs that a classifier confuses more often are
 *     mapped to diatonic triads that share more notes, so a misclassification
 *     lands on a neighbouring chord (a soft harmonic slip) instead of a jarring
 *     jump. The assignment is the bijection maximizing
 *     `Σ confusion(i,j) · sharedTriadNotes(degree(i), degree(j))`; with only
 *     7! = 5040 candidates it is brute-forced, so it can be recomputed from any
 *     *measured* confusion matrix (see issue #64).
 *
 * The prototype weights and the confusion matrix are exported data (open/closed):
 * swap them for a model-specific calibration without touching the algorithms.
 */

/** The seven canonical expressions, in a stable index order. */
export const EXPRESSIONS = [
  'happy',
  'sad',
  'angry',
  'surprised',
  'fearful',
  'disgusted',
  'neutral',
] as const;

export type ExpressionLabel = (typeof EXPRESSIONS)[number];

/** A sparse weighting over blendshape names (missing keys = 0). */
export type BlendshapeWeights = Record<string, number>;

/** The classifier's result: a softmax over {@link EXPRESSIONS} + its argmax. */
export interface ExpressionScores {
  present: boolean;
  /** Softmax probabilities, aligned to {@link EXPRESSIONS} (sums to 1). */
  probs: number[];
  /** argmax label. */
  label: ExpressionLabel;
  /** Probability of {@link label} (= max of {@link probs}); 0 when absent. */
  confidence: number;
}

/**
 * FACS-grounded prototype blendshape vectors, one per expression. Primary action
 * units carry weight 1; supporting units less. Neutral is anchored on the
 * model's own `_neutral` blendshape, so a resting face scores neutral highest.
 * Seeded from the ARKit-blendshape emotion literature (issue #64 refs [1][2]);
 * override via {@link ExpressionOptions.prototypes} for a calibrated set.
 */
export const EXPRESSION_PROTOTYPES: Record<ExpressionLabel, BlendshapeWeights> = {
  happy: { mouthSmileLeft: 1, mouthSmileRight: 1, cheekSquintLeft: 0.4, cheekSquintRight: 0.4 },
  sad: {
    mouthFrownLeft: 1,
    mouthFrownRight: 1,
    browInnerUp: 0.7,
    mouthLowerDownLeft: 0.2,
    mouthLowerDownRight: 0.2,
  },
  angry: {
    browDownLeft: 1,
    browDownRight: 1,
    noseSneerLeft: 0.4,
    noseSneerRight: 0.4,
    mouthPressLeft: 0.3,
    mouthPressRight: 0.3,
  },
  surprised: {
    jawOpen: 1,
    eyeWideLeft: 0.8,
    eyeWideRight: 0.8,
    browOuterUpLeft: 0.7,
    browOuterUpRight: 0.7,
    browInnerUp: 0.4,
  },
  fearful: {
    jawOpen: 0.7,
    eyeWideLeft: 0.9,
    eyeWideRight: 0.9,
    browInnerUp: 0.9,
    browOuterUpLeft: 0.3,
    browOuterUpRight: 0.3,
    mouthStretchLeft: 0.3,
    mouthStretchRight: 0.3,
  },
  disgusted: {
    noseSneerLeft: 1,
    noseSneerRight: 1,
    mouthUpperUpLeft: 0.8,
    mouthUpperUpRight: 0.8,
    browDownLeft: 0.4,
    browDownRight: 0.4,
  },
  neutral: { _neutral: 1 },
};

/** The blendshape dimensions the classifier scores over (union of all prototype
 * keys). Restricting cosine to these FACS-relevant dims keeps gaze/blink noise
 * out of the norm. */
const PROTOTYPE_DIMS: string[] = (() => {
  const dims = new Set<string>();
  for (const proto of Object.values(EXPRESSION_PROTOTYPES)) {
    for (const k of Object.keys(proto)) dims.add(k);
  }
  return [...dims];
})();

export interface ExpressionOptions {
  /** Override the prototype vectors (e.g. a calibrated set). */
  prototypes?: Record<ExpressionLabel, BlendshapeWeights>;
  /** Softmax temperature; lower = sharper. Default 0.12. */
  temperature?: number;
}

function dot(a: BlendshapeWeights, b: BlendshapeWeights, dims: string[]): number {
  let s = 0;
  for (const k of dims) s += (a[k] ?? 0) * (b[k] ?? 0);
  return s;
}

function norm(a: BlendshapeWeights, dims: string[]): number {
  return Math.sqrt(dot(a, a, dims));
}

function softmax(xs: number[], temperature: number): number[] {
  const t = temperature > 0 ? temperature : 1e-6;
  const scaled = xs.map((x) => x / t);
  const max = Math.max(...scaled);
  const exps = scaled.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

/**
 * Classify a blendshape frame into a softmax distribution over the seven
 * {@link EXPRESSIONS}. Cosine similarity to each {@link EXPRESSION_PROTOTYPES}
 * vector (over the FACS-relevant dims) is passed through a temperature softmax.
 * A near-zero face (no activation) falls back to neutral.
 */
export function blendshapesToExpression(
  blendshapes: BlendshapeWeights,
  opts: ExpressionOptions = {},
): ExpressionScores {
  const prototypes = opts.prototypes ?? EXPRESSION_PROTOTYPES;
  const temperature = opts.temperature ?? 0.12;
  const inputNorm = norm(blendshapes, PROTOTYPE_DIMS);

  let sims: number[];
  if (inputNorm < 1e-6) {
    // No measurable expression → certain neutral.
    sims = EXPRESSIONS.map((label) => (label === 'neutral' ? 1 : 0));
  } else {
    sims = EXPRESSIONS.map((label) => {
      const proto = prototypes[label];
      const pn = norm(proto, PROTOTYPE_DIMS);
      if (pn < 1e-6) return 0;
      return dot(blendshapes, proto, PROTOTYPE_DIMS) / (inputNorm * pn);
    });
  }

  const probs = softmax(sims, temperature);
  let argmax = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[argmax]) argmax = i;
  return { present: true, probs, label: EXPRESSIONS[argmax], confidence: probs[argmax] };
}

/** The absent/rest expression: certain neutral, no probs to act on. */
export const ABSENT_EXPRESSION: ExpressionScores = {
  present: false,
  probs: EXPRESSIONS.map((l) => (l === 'neutral' ? 1 : 0)),
  label: 'neutral',
  confidence: 1,
};

// ---- Confusion-aware expression → scale-degree assignment -----------------

/**
 * The three scale-degree indices (0..6) of the diatonic triad rooted on
 * `degree`: the degree itself plus stacked scale-thirds (degree+2, degree+4),
 * wrapped into 0..6. This is the harmonic-distance structure used to score the
 * assignment — two triads sharing more of these degrees sound more alike.
 */
export function triadDegreeSet(degree: number): [number, number, number] {
  const d = ((degree % 7) + 7) % 7;
  return [d, (d + 2) % 7, (d + 4) % 7];
}

/** How many notes two diatonic triads share (0..3), by their root degrees. */
export function sharedTriadNotes(degreeA: number, degreeB: number): number {
  const a = new Set(triadDegreeSet(degreeA));
  let shared = 0;
  for (const n of triadDegreeSet(degreeB)) if (a.has(n)) shared++;
  return shared;
}

/**
 * Symmetric expression-confusion weights, seeded from FER2013 and corroborating
 * FER literature/human studies (issue #64 refs [6]-[9]): higher = more often
 * mistaken for one another. The negative cluster {anger, disgust, fear, sad} +
 * neutral is the confusable core; happy is the most distinct, surprise second.
 * Indexed by {@link EXPRESSIONS} order; only the listed pairs are non-zero.
 * Override with a *measured* matrix and re-run {@link optimalExpressionToDegree}.
 */
export const CONFUSION_FER2013: number[][] = buildConfusionMatrix({
  'sad|neutral': 0.3,
  'fearful|sad': 0.22,
  'angry|disgusted': 0.18,
  'angry|sad': 0.14,
  'angry|fearful': 0.12,
  'fearful|neutral': 0.08,
  'fearful|surprised': 0.08,
  'happy|neutral': 0.07,
  'disgusted|sad': 0.06,
  'angry|neutral': 0.06,
  'disgusted|fearful': 0.05,
  'disgusted|neutral': 0.05,
  'surprised|happy': 0.03,
});

function buildConfusionMatrix(pairs: Record<string, number>): number[][] {
  const idx = new Map(EXPRESSIONS.map((e, i) => [e, i]));
  const n = EXPRESSIONS.length;
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const [pair, w] of Object.entries(pairs)) {
    const [a, b] = pair.split('|') as ExpressionLabel[];
    const i = idx.get(a);
    const j = idx.get(b);
    if (i === undefined || j === undefined) throw new Error(`unknown expression in pair: ${pair}`);
    m[i][j] = w;
    m[j][i] = w;
  }
  return m;
}

/** An expression→degree bijection, keyed by {@link ExpressionLabel}. */
export type ExpressionToDegree = Record<ExpressionLabel, number>;

/**
 * The assignment objective: total confusion-weighted shared-note mass. Higher is
 * better — confused pairs landing on note-sharing triads contribute the most.
 */
export function assignmentObjective(
  assignment: ExpressionToDegree,
  confusion: number[][] = CONFUSION_FER2013,
): number {
  let total = 0;
  for (let i = 0; i < EXPRESSIONS.length; i++) {
    for (let j = i + 1; j < EXPRESSIONS.length; j++) {
      const w = confusion[i][j];
      if (w === 0) continue;
      total += w * sharedTriadNotes(assignment[EXPRESSIONS[i]], assignment[EXPRESSIONS[j]]);
    }
  }
  return total;
}

/**
 * Brute-force the bijection (expressions → degrees 0..6) maximizing
 * {@link assignmentObjective}. 7! = 5040 permutations, so exhaustive search is
 * cheap and exact. Ties are broken deterministically (first permutation wins).
 */
export function optimalExpressionToDegree(
  confusion: number[][] = CONFUSION_FER2013,
): ExpressionToDegree {
  let best: ExpressionToDegree | null = null;
  let bestScore = -Infinity;
  for (const perm of permutations([0, 1, 2, 3, 4, 5, 6])) {
    const assignment = Object.fromEntries(
      EXPRESSIONS.map((e, i) => [e, perm[i]]),
    ) as ExpressionToDegree;
    const score = assignmentObjective(assignment, confusion);
    if (score > bestScore) {
      bestScore = score;
      best = assignment;
    }
  }
  return best as ExpressionToDegree;
}

function* permutations(items: number[]): Generator<number[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i], ...p];
  }
}

/**
 * The shipped assignment: the objective-maximizing bijection for the seeded
 * {@link CONFUSION_FER2013} matrix, i.e. the value of
 * `optimalExpressionToDegree(CONFUSION_FER2013)` (issue #64 asks to recompute the
 * mapping on the shipped classifier's matrix rather than reuse the issue's
 * illustrative FER2013-literature table). It is genuinely optimal (objective ≈
 * 2.11), and conveniently it ALSO keeps `happy` on the tonic (degree 0, the
 * resting "home" chord) and places all FIVE non-trivial confusion pairs on
 * 2-note-sharing triads — disgust↔anger, anger↔fear, fear↔sad, sad↔neutral, and
 * happy↔neutral. (The issue's hand-table left happy↔neutral on a 1-note pair;
 * the true optimum fixes that at no cost to the tonic placement.)
 *
 *   happy→I(0)  fearful→ii(1)  surprised→iii(2)  sad→IV(3)
 *   disgusted→V(4)  neutral→vi(5)  angry→vii°(6)
 *
 * Recompute with {@link optimalExpressionToDegree} against a *measured* confusion
 * matrix to retune for a calibrated classifier.
 */
export const RECOMMENDED_EXPRESSION_TO_DEGREE: ExpressionToDegree = {
  happy: 0,
  fearful: 1,
  surprised: 2,
  sad: 3,
  disgusted: 4,
  neutral: 5,
  angry: 6,
};

/** The expression→degree assignment the chord mapping ships with. */
export const DEFAULT_EXPRESSION_TO_DEGREE = RECOMMENDED_EXPRESSION_TO_DEGREE;
