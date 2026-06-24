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

/**
 * The six *scored* emotions. Neutral is the abstention FALLBACK (the decision when
 * no emotion clears its threshold), not a scored class — for a prototype/cosine
 * classifier without a strong neutral exemplar, abstention is far more robust than
 * asking a neutral prototype to out-score everything (Bishop, reject option;
 * open-set recognition bounds the acceptance region instead of partitioning all of
 * feature space among the known classes).
 */
export const EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'fearful', 'disgusted'] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** A sparse weighting over blendshape names (missing keys = 0). */
export type BlendshapeWeights = Record<string, number>;

/**
 * The classifier's per-frame result (flows on the DAG edge). `scores` are the
 * per-emotion activations and `thresholds` their effective firing thresholds (both
 * aligned to {@link EMOTIONS}, for the readout); `fired` is score ≥ threshold; and
 * `label` is the decided expression — one of the six emotions or `neutral`.
 */
export interface ExpressionScores {
  present: boolean;
  label: ExpressionLabel;
  scores: number[];
  thresholds: number[];
  fired: boolean[];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * FACS-grounded prototype blendshape vectors, one per emotion. Primary action
 * units carry weight 1; supporting units less. Seeded from the ARKit-blendshape
 * emotion literature (issue #64 refs [1][2]); swap for a calibrated set. (Neutral
 * has no prototype — it is the abstention fallback, not a scored class.)
 *
 * NOTE on `sad`/`disgusted`: the MediaPipe Blendshape model **under-reports**
 * several channels — `noseSneer`, `mouthFrown`, `browInnerUp`, `eyeWide` cap near
 * zero even on a strong genuine expression (model card: AR-entertainment grade;
 * MediaPipe issues #5329, #4450). So these two prototypes deliberately lean on the
 * RELIABLE neighbouring units (the lower-lip drop for sad, the upper-lip raise for
 * disgust) rather than the weak primary AU, so a real expression can clear the bar.
 */
export const EXPRESSION_PROTOTYPES: Record<Emotion, BlendshapeWeights> = {
  happy: { mouthSmileLeft: 1, mouthSmileRight: 1, cheekSquintLeft: 0.4, cheekSquintRight: 0.4 },
  sad: {
    // Rebalanced off the under-reported mouthFrown/browInnerUp onto the more
    // reliable lower-lip drop (den 2.7). The lower-lip weight is CAPPED so it can't
    // satisfy sad on its own — an open mouth (yawn / loud vowel) drives
    // mouthLowerDown high via jawOpen, and at 0.45 each it tops out at 0.9/2.7 =
    // 0.33, below the 0.375 firing bar, so a non-frowning open mouth stays neutral;
    // a real frown + lip-drop still clears. (Old all-hard-weight prototype was
    // unreachable; 0.6 each let a yawn false-fire sad — see review.)
    mouthFrownLeft: 0.7,
    mouthFrownRight: 0.7,
    browInnerUp: 0.4,
    mouthLowerDownLeft: 0.45,
    mouthLowerDownRight: 0.45,
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
    // Weighted toward the reliable upper-lip raise (the model pins noseSneer near
    // zero), so a strong sneer fires. den 4.2.
    noseSneerLeft: 0.7,
    noseSneerRight: 0.7,
    mouthUpperUpLeft: 1,
    mouthUpperUpRight: 1,
    browDownLeft: 0.4,
    browDownRight: 0.4,
  },
};

/**
 * Magnitude-aware activation of each emotion: the weighted-mean activation of its
 * FACS blendshapes, in [0,1] (0 = those action units at rest, 1 = fully active).
 * Unlike cosine similarity this is NOT scale-invariant — a faint resting brow
 * furrow yields a tiny `angry` activation, so it cannot clear a threshold. (That
 * scale-invariance is exactly why the old cosine classifier read a neutral face
 * as angry: the direction matched even though the magnitude was negligible.) Pure.
 */
export function expressionActivations(
  blendshapes: BlendshapeWeights,
  prototypes: Record<Emotion, BlendshapeWeights> = EXPRESSION_PROTOTYPES,
): Record<Emotion, number> {
  const out = {} as Record<Emotion, number>;
  for (const e of EMOTIONS) {
    let num = 0;
    let den = 0;
    for (const k in prototypes[e]) {
      const w = prototypes[e][k];
      num += (blendshapes[k] ?? 0) * w;
      den += w;
    }
    out[e] = den > 0 ? clamp01(num / den) : 0;
  }
  return out;
}

/**
 * Per-emotion operating-point bounds (calibration constants — NOT calibrated
 * probabilities; cosine/activation "confidence" is uncalibrated, so these are
 * tuned operating points). `sensitivity` 0 → `max` (hardest, almost nothing
 * fires), 1 → `min` (easiest). `delta` is the hysteresis band (enter − delta =
 * the easier exit threshold). `angry`/`fearful` start slightly stricter (they are
 * the spurious-prone / overlapping ones).
 */
export interface ExpressionThresholdBounds {
  min: number;
  max: number;
  delta: number;
}
export const EXPRESSION_THRESHOLD_BOUNDS: Record<Emotion, ExpressionThresholdBounds> = {
  happy: { min: 0.15, max: 0.6, delta: 0.06 },
  sad: { min: 0.15, max: 0.6, delta: 0.06 },
  angry: { min: 0.2, max: 0.65, delta: 0.06 },
  surprised: { min: 0.15, max: 0.6, delta: 0.06 },
  // Lower max (→ default firing bar 0.40) — a realistic fear face barely clears it
  // because the eyeWide/browInnerUp channels read weakly on this model.
  fearful: { min: 0.2, max: 0.6, delta: 0.06 },
  disgusted: { min: 0.15, max: 0.6, delta: 0.06 },
};

export type ExpressionSensitivity = Record<Emotion, number>;

/** Default per-emotion sensitivity (angry slightly stricter — spurious-prone). */
export const DEFAULT_EXPRESSION_SENSITIVITY: ExpressionSensitivity = {
  happy: 0.5,
  sad: 0.5,
  angry: 0.45,
  surprised: 0.5,
  fearful: 0.5,
  disgusted: 0.5,
};

/** A per-emotion sensitivity in [0,1] → its firing threshold, monotone DECREASING
 *  (more sensitive = lower bar = more hits). */
export function sensitivityToThreshold(sensitivity: number, bounds: ExpressionThresholdBounds): number {
  return bounds.max - clamp01(sensitivity) * (bounds.max - bounds.min);
}

/** The effective (enter) firing threshold for each emotion at the given sensitivities. */
export function expressionThresholds(
  sensitivity: ExpressionSensitivity = DEFAULT_EXPRESSION_SENSITIVITY,
): Record<Emotion, number> {
  const out = {} as Record<Emotion, number>;
  for (const e of EMOTIONS) {
    out[e] = sensitivityToThreshold(
      sensitivity[e] ?? DEFAULT_EXPRESSION_SENSITIVITY[e],
      EXPRESSION_THRESHOLD_BOUNDS[e],
    );
  }
  return out;
}

export interface ExpressionDecision {
  label: ExpressionLabel;
  fired: Record<Emotion, boolean>;
  /** The effective threshold each emotion was judged against — the easier EXIT
   *  threshold for the `held` label, the ENTER threshold otherwise. Returned so a
   *  readout's threshold line matches `fired` (a single source of truth). */
  thresholds: Record<Emotion, number>;
}

/**
 * Decide the expression from per-emotion activations + per-emotion sensitivities:
 *  - an emotion *fires* when its activation ≥ its threshold;
 *  - if NONE fire → `neutral` (the abstention fallback, Chow's reject rule);
 *  - among those that fire, the winner has the greatest margin OVER ITS OWN
 *    threshold (so a more-sensitive emotion both fires more often AND wins ties —
 *    the operating-point generalization of argmax; per-class thresholds don't move
 *    the underlying scores, only eligibility).
 * `held` (the currently-committed label, if any) is judged against the easier EXIT
 * threshold (enter − delta) — a Schmitt-trigger / Canny hysteresis against chatter.
 * Pure.
 */
export function decideExpression(
  activations: Record<Emotion, number>,
  sensitivity: ExpressionSensitivity = DEFAULT_EXPRESSION_SENSITIVITY,
  held?: ExpressionLabel,
): ExpressionDecision {
  const fired = {} as Record<Emotion, boolean>;
  const thresholds = {} as Record<Emotion, number>;
  let winner: Emotion | null = null;
  let bestMargin = -Infinity;
  for (const e of EMOTIONS) {
    const bounds = EXPRESSION_THRESHOLD_BOUNDS[e];
    const enter = sensitivityToThreshold(sensitivity[e] ?? DEFAULT_EXPRESSION_SENSITIVITY[e], bounds);
    const threshold = e === held ? enter - bounds.delta : enter;
    thresholds[e] = threshold;
    const margin = (activations[e] ?? 0) - threshold;
    fired[e] = margin >= 0;
    if (fired[e] && margin > bestMargin) {
      bestMargin = margin;
      winner = e;
    }
  }
  return { label: winner ?? 'neutral', fired, thresholds };
}

/** The absent/rest expression: neutral, nothing fired. */
export const ABSENT_EXPRESSION: ExpressionScores = {
  present: false,
  label: 'neutral',
  scores: EMOTIONS.map(() => 0),
  thresholds: EMOTIONS.map(() => 0),
  fired: EMOTIONS.map(() => false),
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

/**
 * Sentinel degree meaning "play nothing" — an expression mapped to {@link
 * SILENCE_DEGREE} contributes no chord (an empty note set). Any expression can be
 * assigned to it; `neutral` defaults to it (a resting face is silence). A negative
 * value so it survives `?? default` lookups (unlike `null`, which `??` would
 * replace) and is trivially distinguished from a real scale degree (0..6).
 */
export const SILENCE_DEGREE = -1;

/**
 * The expression→degree assignment the chord mapping ships with: the confusion-aware
 * {@link RECOMMENDED_EXPRESSION_TO_DEGREE} for the six emotions, but `neutral`
 * defaults to {@link SILENCE_DEGREE} (silence) — a resting face plays nothing
 * unless the player assigns it a degree. (RECOMMENDED itself stays the pure 0..6
 * bijection the optimizer produces, for the confusion-assignment tests.)
 */
export const DEFAULT_EXPRESSION_TO_DEGREE: ExpressionToDegree = {
  ...RECOMMENDED_EXPRESSION_TO_DEGREE,
  neutral: SILENCE_DEGREE,
};
