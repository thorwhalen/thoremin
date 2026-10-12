/**
 * The recogniser: hand frames in, one score per sign out, every frame.
 *
 * Per frame it picks the signing hand (the one whose wrist is highest in the image, as in
 * training), scores its shape with the static model, and keeps a short history of that hand
 * for the motion model. The two models fuse into ONE distribution over {@link SIGN_IDS}: a
 * static letter's score is its static probability times the motion model's "no motion
 * sign" probability, a motion sign's score is the motion model's own. So the bars always
 * sum to one, and a held letter and a sign in flight compete on one scale.
 *
 * On top of the raw scores: exponential smoothing (a time constant, so the result does not
 * depend on the frame rate), a confidence floor below which no sign is named, hysteresis (a
 * new sign must beat the current one by a margin to take over), and a latch that keeps a
 * motion sign on screen for a moment after its movement ends (a word is over by the time it
 * is recognised).
 */
import { handFeatures, type FeatureKind, type HandInput } from './features';
import { mlpPredict, type MlpModel } from './mlp';
import { motionMeta, scoreMotion, toMotionFrame, type MotionFrame } from './motion';
import { SIGN_IDS, STATIC_SIGNS, type SignId } from './labels';

export interface SignFrame {
  width: number;
  height: number;
  hands: readonly HandInput[];
}

export interface SignScores {
  /** A hand is being read. */
  present: boolean;
  /** The sign currently named, or null (no hand, or nothing confident enough). */
  label: SignId | null;
  /** Every class, in {@link SIGN_IDS} order. */
  labels: readonly SignId[];
  /** Smoothed 0..1 score per class, aligned with `labels`; sums to 1 while a hand is read. */
  scores: number[];
  /** Whether the named sign is a held shape or a movement. */
  kind: 'static' | 'motion' | null;
  /** Which hand signs. */
  hand: 'Left' | 'Right' | null;
}

export interface RecognizerOptions {
  /** Smoothing time constant in seconds (0 = none). */
  smoothing?: number;
  /** A sign is named only when its smoothed score reaches this. */
  minConfidence?: number;
  /** A new sign takes over only when it beats the current one by this much. */
  switchMargin?: number;
  /** How long a recognised motion sign stays named after it fires (s). */
  motionHold?: number;
  /** A motion sign fires when its raw window probability reaches this (default: the model's). */
  motionThreshold?: number;
  /** History kept for the motion model (s): the longest window plus slack. */
  history?: number;
  /** Frames closer than this are not added to the motion history (s): the training rate. */
  minFrameGap?: number;
  /** Frames without a hand longer than this clear the history (s). */
  dropout?: number;
}

export const DEFAULT_RECOGNIZER_OPTIONS: Required<Omit<RecognizerOptions, 'motionThreshold'>> = {
  smoothing: 0.12,
  minConfidence: 0.45,
  switchMargin: 0.1,
  motionHold: 1.0,
  history: 2.0,
  minFrameGap: 1 / 15,
  dropout: 0.35,
};

export interface SignRecognizer {
  /** Read one frame taken at `t` seconds (the camera's capture time where there is one). A
   *  frame whose `t` has not advanced is the same camera frame ticked again: the last reading
   *  is returned unchanged. */
  update(frame: SignFrame | null | undefined, t: number): SignScores;
  /** Retune the smoothing, confidence floor, margin or hold WITHOUT losing the history (a
   *  slider drag calls this every frame). */
  setOptions(options: Omit<RecognizerOptions, 'history' | 'minFrameGap'>): void;
  reset(): void;
}

/** The hand a signer signs with: the highest wrist in the image. */
export function signingHand(hands: readonly HandInput[]): HandInput | null {
  let best: HandInput | null = null;
  for (const h of hands) if (h.keypoints.length >= 21 && (!best || h.keypoints[0]!.y < best.keypoints[0]!.y)) best = h;
  return best;
}

export function emptyScores(): SignScores {
  return { present: false, label: null, labels: SIGN_IDS, scores: SIGN_IDS.map(() => 0), kind: null, hand: null };
}

export function createSignRecognizer(staticModel: MlpModel, motionModel: MlpModel | null = null, options: RecognizerOptions = {}): SignRecognizer {
  const o = { ...DEFAULT_RECOGNIZER_OPTIONS, ...options };
  const meta = motionModel ? motionMeta(motionModel) : null;
  let motionThreshold = options.motionThreshold ?? meta?.threshold ?? 0.6;
  const staticIdx = staticModel.labels.map((l) => SIGN_IDS.indexOf(l as SignId));
  const motionIdx = motionModel?.labels.map((l) => SIGN_IDS.indexOf(l as SignId)) ?? [];
  const noneIdx = motionModel?.labels.indexOf('none') ?? -1;

  let history: MotionFrame[] = [];
  let smoothed = SIGN_IDS.map(() => 0);
  let lastT: number | null = null;
  let lastHandT = -Infinity;
  let current: SignId | null = null;
  let latched: { id: SignId; until: number } | null = null;
  /** The best motion sign on the previous frame was above threshold: a latch arms on the
   *  rising edge only, so a movement that stays inside the longest window does not keep
   *  re-arming it (and hold the word on screen for seconds). */
  let motionWasHigh = false;
  let last: SignScores = emptyScores();

  function reset(): void {
    history = [];
    smoothed = SIGN_IDS.map(() => 0);
    lastT = null;
    lastHandT = -Infinity;
    current = null;
    latched = null;
    motionWasHigh = false;
    last = emptyScores();
  }

  function setOptions(next: Omit<RecognizerOptions, 'history' | 'minFrameGap'>): void {
    for (const [k, v] of Object.entries(next)) if (v !== undefined && k !== 'motionThreshold') (o as Record<string, unknown>)[k] = v;
    if (next.motionThreshold !== undefined) motionThreshold = next.motionThreshold;
  }

  function update(frame: SignFrame | null | undefined, t: number): SignScores {
    if (lastT !== null && t <= lastT) return last;
    const dt = lastT === null ? 0 : t - lastT;
    lastT = t;
    const hand = frame ? signingHand(frame.hands) : null;
    const x = hand && frame ? handFeatures(hand, frame.width, staticModel.features as FeatureKind) : null;
    if (!hand || !x) {
      // A frame or two without the hand (tracking blinked) keeps the last reading, so a
      // held chord does not dip; a longer absence is the hand gone.
      if (last.present && t - lastHandT <= o.dropout) return last;
      reset();
      lastT = t;
      return last;
    }
    lastHandT = t;

    const post = mlpPredict(staticModel, x);
    const raw = SIGN_IDS.map(() => 0);

    let motion: number[] | null = null;
    if (motionModel && meta) {
      const rec = toMotionFrame(hand, post, t);
      const last = history[history.length - 1];
      if (!last || t - last.t >= o.minFrameGap - 1e-6) history.push(rec);
      while (history.length && history[0]!.t < t - o.history) history.shift();
      motion = scoreMotion(motionModel, history, meta);
    }

    const pNone = motion && noneIdx >= 0 ? motion[noneIdx]! : 1;
    post.forEach((p, i) => {
      const j = staticIdx[i]!;
      if (j >= 0) raw[j]! += p * pNone;
    });
    if (motion) {
      motion.forEach((p, i) => {
        const j = motionIdx[i]!;
        if (i !== noneIdx && j >= 0) raw[j]! += p;
      });
    }

    // The first frame of a hand starts from its own reading, not from zeros.
    const alpha = last.present && o.smoothing > 0 && dt > 0 ? 1 - Math.exp(-dt / o.smoothing) : 1;
    smoothed = smoothed.map((s, i) => s + (raw[i]! - s) * alpha);

    // A motion sign fires on its RAW window probability (smoothing would blunt a
    // half-second movement) and is latched so it can be read.
    if (motion) {
      let bi = -1;
      let bp = 0;
      motion.forEach((p, i) => {
        if (i !== noneIdx && p > bp) {
          bp = p;
          bi = i;
        }
      });
      const high = bi >= 0 && bp >= motionThreshold && motionIdx[bi]! >= 0;
      if (high && (!motionWasHigh || latched?.id !== SIGN_IDS[motionIdx[bi]!])) latched = { id: SIGN_IDS[motionIdx[bi]!]!, until: t + o.motionHold };
      motionWasHigh = high;
    }
    if (latched && t > latched.until) latched = null;

    let label: SignId | null;
    if (latched) label = latched.id;
    else {
      let top = 0;
      for (let i = 1; i < smoothed.length; i++) if (smoothed[i]! > smoothed[top]!) top = i;
      const topId = SIGN_IDS[top]!;
      const cur = current ? smoothed[SIGN_IDS.indexOf(current)]! : 0;
      if (smoothed[top]! < o.minConfidence) label = null;
      else if (current && topId !== current && cur >= o.minConfidence && smoothed[top]! < cur + o.switchMargin) label = current;
      else label = topId;
    }
    current = label;
    const kind = label === null ? null : STATIC_SIGNS.includes(label) ? 'static' : 'motion';
    last = { present: true, label, labels: SIGN_IDS, scores: smoothed.slice(), kind, hand: hand.handedness };
    return last;
  }

  return { update, setOptions, reset };
}
