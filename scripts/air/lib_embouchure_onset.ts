/**
 * Embouchure onsets (#248): does the mouth signal a flute note before the sound does,
 * and by how much?
 *
 * Two readings of the same face stream, both scored against the audio's refined note
 * onsets (`label_note_onsets.py`, a few ms of precision):
 *
 * 1. **The profile** ({@link onsetProfile}): an *oracle* reading. Around each known
 *    audio onset, did a mouth signal change at all between the silence before it and the
 *    note, and when did it cross 10 / 50 / 90 % of the way from its resting level to its
 *    playing level? The 10 % crossing is "the mouth starts to move", the 90 % is "the
 *    embouchure has settled". Leads are audio onset minus crossing time: positive means
 *    the mouth came first. The resting level is read at the START of the silence the
 *    onset had (the previous note's end), so a mouth that stayed set through a short
 *    rest reads as "did not move", which is the finding, not a miss. This answers the
 *    physiology question with no detector in the way.
 *
 * 2. **The detector** ({@link createEmbouchureDetector}): a *causal* reading, the thing
 *    that could run in the app. One scalar mouth signal in, `Anchor`s out (the
 *    `packages/ictus/src` contract, so a mouth onset can be fed to a `RhythmPrior` exactly as a
 *    drum stroke is). Two modes: `level` fires when the signal departs from its resting
 *    baseline by a threshold in NOISE UNITS (multiples of the signal's own frame-to-frame
 *    jitter, from `packages/sdk/src/enroll/noise.ts`, the trainer's convention), which is the
 *    "embouchure forms" event; `velocity` fires on any movement faster than a threshold,
 *    which is the only thing that can see a re-articulation inside a held embouchure.
 *    Both interpolate the crossing time below the frame period, hold a refractory
 *    window, and re-arm with hysteresis. Scored by one-to-one matching
 *    ({@link matchEvents}) inside an asymmetric window (the mouth may lead by hundreds of
 *    ms, it may not trail by more than a frame or two), giving hit / miss / false-alarm
 *    rates and the lead distribution.
 *
 * The signals ({@link mouthSignals}) are the twenty embouchure blendshapes the fingering
 * model already used, plus, when the stream carries the lip landmarks
 * (`extract_mouth.py`), the lip GEOMETRY: the inner-lip aperture, the lip-corner width,
 * the outer-lip height, the jaw drop and the lip protrusion, each normalised by the
 * inter-ocular distance so they mean the same thing at any distance from the camera.
 * A blendshape is a network's estimate that may lag the mesh it is computed from; the
 * geometry is the mesh itself, and the two are reported side by side so a lag in the
 * blendshape head is not mistaken for the mouth's own timing.
 *
 * Two noise units appear here and are close but not identical: the profile's sigma is
 * the MAD-scaled frame-to-frame jitter of the whole series ({@link jitterSigma}, an
 * offline number), the detector's is `packages/sdk/src/enroll/noise.ts`'s clipped running estimate
 * (a mean absolute difference, about 1.13 sigma for Gaussian noise, floored at 1 % of
 * the running range), because the detector must be causal. A threshold of "4 sigma"
 * in one table is therefore within a fifth of the other's.
 *
 * Pure: no DAG, no React, no file I/O except {@link readMouthFrames}. Tests run it on
 * synthetic streams (`test/air/embouchure_onset.test.ts`); the footage is local only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { StreamRecord } from '@thoremin/dag';
import { createNoiseEstimator, type NoiseEstimator } from '@thoremin/sdk/enroll/noise';
import type { FeatureVector } from '@thoremin/sdk/features/catalog';
import type { Anchor } from '@thoremin/ictus/types';
import { EMBOUCHURE_BLENDSHAPES } from './lib_wind_string_features';

// ---- The stream ----------------------------------------------------------------------

/** One face frame as the mouth reading needs it. `points` are MediaPipe mesh indices →
 *  normalised `[x, y, z]`, present only in a `.mouth.ndjson` stream. */
export interface MouthFrame {
  t: number;
  present: boolean;
  blendshapes: Record<string, number>;
  points?: Record<string, [number, number, number]>;
}

function parseRecords(text: string): StreamRecord[] {
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as StreamRecord);
}

/** Read a `.face.ndjson` or `.mouth.ndjson[.gz]` stream into mouth frames. */
export function readMouthFrames(path: string): MouthFrame[] {
  const text = path.endsWith('.gz')
    ? gunzipSync(readFileSync(path)).toString('utf8')
    : !existsSync(path) && existsSync(`${path}.gz`)
      ? gunzipSync(readFileSync(`${path}.gz`)).toString('utf8')
      : readFileSync(path, 'utf8');
  return mouthFrames(parseRecords(text));
}

export function mouthFrames(records: readonly StreamRecord[]): MouthFrame[] {
  return records.map((r) => {
    const v = r.value as { present?: boolean; blendshapes?: Record<string, number>; points?: Record<string, [number, number, number]> };
    return { t: r.t, present: v.present === true, blendshapes: v.blendshapes ?? {}, points: v.points };
  });
}

// ---- The signals ---------------------------------------------------------------------

/** Mesh indices the geometry reads (MediaPipe face mesh). */
export const MESH = {
  upperLipInner: 13,
  lowerLipInner: 14,
  upperLipOuter: 0,
  lowerLipOuter: 17,
  leftCorner: 61,
  rightCorner: 291,
  noseTip: 1,
  chin: 152,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
} as const;

/** Inner lip contour, for the protrusion (mean depth of the lips against the eyes). */
const INNER_LIPS = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];

export const GEOMETRY_SIGNALS = ['lip.aperture', 'lip.width', 'lip.height', 'jaw.drop', 'lip.protrusion'] as const;
export const BLENDSHAPE_SIGNALS = EMBOUCHURE_BLENDSHAPES.map((n) => `face.${n}`);
/** Every signal id the reading can produce, blendshapes first. */
export const MOUTH_SIGNALS: readonly string[] = [...BLENDSHAPE_SIGNALS, ...GEOMETRY_SIGNALS];

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The scalar mouth signals of one frame; `NaN` for anything the frame cannot give. */
export function mouthSignals(frame: MouthFrame): FeatureVector {
  const out: FeatureVector = {};
  for (const name of EMBOUCHURE_BLENDSHAPES) {
    const v = frame.present ? frame.blendshapes[name] : undefined;
    out[`face.${name}`] = typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  }
  for (const id of GEOMETRY_SIGNALS) out[id] = NaN;
  const p = frame.present ? frame.points : undefined;
  if (!p) return out;
  const pt = (i: number) => p[String(i)];
  const eyeL = pt(MESH.leftEyeOuter);
  const eyeR = pt(MESH.rightEyeOuter);
  if (!eyeL || !eyeR) return out;
  const scale = dist(eyeL, eyeR);
  if (!(scale > 0)) return out;
  const ratio = (i: number, j: number) => {
    const a = pt(i);
    const b = pt(j);
    return a && b ? dist(a, b) / scale : NaN;
  };
  out['lip.aperture'] = ratio(MESH.upperLipInner, MESH.lowerLipInner);
  out['lip.width'] = ratio(MESH.leftCorner, MESH.rightCorner);
  out['lip.height'] = ratio(MESH.upperLipOuter, MESH.lowerLipOuter);
  out['jaw.drop'] = ratio(MESH.noseTip, MESH.chin);
  let z = 0;
  let n = 0;
  for (const i of INNER_LIPS) {
    const q = pt(i);
    if (q) {
      z += q[2];
      n++;
    }
  }
  // MediaPipe's z grows AWAY from the camera, so a pucker (lips forward) makes this
  // more negative; negate so "more protruded" is larger, like the blendshape.
  out['lip.protrusion'] = n ? -((z / n - (eyeL[2] + eyeR[2]) / 2) / scale) : NaN;
  return out;
}

/** One signal as a time series over the frames it is finite in. */
export function series(frames: readonly MouthFrame[], signal: string): { t: number[]; x: number[] } {
  const t: number[] = [];
  const x: number[] = [];
  for (const f of frames) {
    const v = mouthSignals(f)[signal];
    if (Number.isFinite(v)) {
      t.push(f.t);
      x.push(v);
    }
  }
  return { t, x };
}

/** Every signal at once (one pass over the frames; the CLI's shape). */
export function allSeries(frames: readonly MouthFrame[], signals: readonly string[] = MOUTH_SIGNALS): Record<string, { t: number[]; x: number[] }> {
  const out: Record<string, { t: number[]; x: number[] }> = {};
  for (const s of signals) out[s] = { t: [], x: [] };
  for (const f of frames) {
    const v = mouthSignals(f);
    for (const s of signals) {
      if (Number.isFinite(v[s])) {
        out[s].t.push(f.t);
        out[s].x.push(v[s]);
      }
    }
  }
  return out;
}

// ---- Small statistics ----------------------------------------------------------------

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(s.length - 1, lo + 1);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Median absolute deviation, scaled to a Gaussian sigma (x1.4826). */
export function mad(xs: readonly number[]): number {
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

export interface LeadStats {
  n: number;
  median: number;
  /** Robust spread: 1.4826 x MAD. */
  mad: number;
  p10: number;
  p90: number;
  mean: number;
  sd: number;
}

export function leadStats(leads: readonly number[]): LeadStats {
  const n = leads.length;
  const mean = n ? leads.reduce((a, b) => a + b, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(leads.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  return { n, median: median(leads), mad: mad(leads), p10: quantile(leads, 0.1), p90: quantile(leads, 0.9), mean, sd };
}

/** The robust sigma of a series' frame-to-frame differences: its jitter, the noise unit. */
export function jitterSigma(x: readonly number[]): number {
  const d: number[] = [];
  for (let i = 1; i < x.length; i++) d.push(Math.abs(x[i] - x[i - 1]));
  // Absolute differences of Gaussian noise have median 0.6745 x sqrt(2) x sigma.
  return median(d) / (0.6745 * Math.SQRT2);
}

// ---- The profile (oracle) ------------------------------------------------------------

export interface ProfileOptions {
  /** Resting level: the median over the first `restSeconds` of the onset's search span
   *  (from `from` on), capped at a third of the span. */
  restSeconds?: number;
  /** Playing level: the median over [t + playFrom, t + playTo] after the onset. */
  playFrom?: number;
  playTo?: number;
  /** A change smaller than this many noise units is "did not move". */
  minChangeNoiseUnits?: number;
  /** The signal's noise sigma; estimated from the whole series when absent. */
  sigma?: number;
}

/** An audio onset and where its search span starts: the end of the previous note (or
 *  the previous sound), so the resting level is read from the silence the mouth had. */
export interface ProfiledOnset {
  t: number;
  from: number;
}

export interface OnsetProfile {
  /** The audio onset this is about. */
  t: number;
  /** Whether the signal could be read at all: enough frames in both the resting and
   *  the playing window. When false, nothing below is known; a consumer must leave
   *  the onset out of every fraction rather than count it as "did not move". */
  measured: boolean;
  /** Rest → play change in noise units (signed: + = the signal rose). */
  changeNoiseUnits: number;
  moved: boolean;
  /** Audio onset minus the time the signal crossed 10 / 50 / 90 % of its change on the
   *  LAST rise into the playing level; positive = the mouth led. NaN when not moved. */
  lead10: number;
  lead50: number;
  lead90: number;
  /** Audio onset minus the time of the signal's largest excursion from its resting
   *  level anywhere in the span before the onset: a breath (the mouth opens, then
   *  closes onto the embouchure) shows here and not in the crossings. NaN when the
   *  excursion is under the movement threshold. */
  leadPeak: number;
}

const PROFILE_DEFAULTS = { restSeconds: 0.3, playFrom: 0.05, playTo: 0.3, minChangeNoiseUnits: 3 };
/** Fewer frames than this in a window and the level cannot be read. */
const MIN_WINDOW_FRAMES = 3;

function crossing(t: readonly number[], x: readonly number[], i0: number, i1: number, level: number, rising: boolean): number {
  // First crossing of `level` in (i0, i1], linearly interpolated.
  for (let i = Math.max(i0, 1); i <= i1; i++) {
    const a = x[i - 1];
    const b = x[i];
    const crossed = rising ? a < level && b >= level : a > level && b <= level;
    if (crossed) {
      const f = b === a ? 0 : (level - a) / (b - a);
      return t[i - 1] + f * (t[i] - t[i - 1]);
    }
  }
  return NaN;
}

/** Index of the first sample with `t >= time` (binary search over sorted `ts`). */
function lowerBound(ts: readonly number[], time: number): number {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The oracle profile of one signal around each audio onset. */
export function onsetProfile(t: readonly number[], x: readonly number[], onsets: readonly ProfiledOnset[], o: ProfileOptions = {}): OnsetProfile[] {
  const opt = { ...PROFILE_DEFAULTS, ...o };
  const sigma = o.sigma ?? jitterSigma(x);
  const out: OnsetProfile[] = [];
  for (const { t: on, from } of onsets) {
    const span = on - from;
    const restLen = Math.min(opt.restSeconds, span / 3);
    const i0 = lowerBound(t, from);
    const rest = x.slice(i0, lowerBound(t, from + restLen));
    const play = x.slice(lowerBound(t, on + opt.playFrom), lowerBound(t, on + opt.playTo));
    const none = { t: on, measured: true, changeNoiseUnits: NaN, moved: false, lead10: NaN, lead50: NaN, lead90: NaN, leadPeak: NaN };
    if (rest.length < MIN_WINDOW_FRAMES || play.length < MIN_WINDOW_FRAMES || !(sigma > 0)) {
      out.push({ ...none, measured: false });
      continue;
    }
    const r = median(rest);
    const p = median(play);
    const change = (p - r) / sigma;
    // The largest excursion from rest before the sound, whichever way it goes.
    let peakAt = NaN;
    let peak = 0;
    for (let i = i0; i < t.length && t[i] <= on; i++) {
      const d = Math.abs(x[i] - r);
      if (d > peak) {
        peak = d;
        peakAt = t[i];
      }
    }
    const leadPeak = peak / sigma >= opt.minChangeNoiseUnits ? on - peakAt : NaN;
    if (Math.abs(change) < opt.minChangeNoiseUnits) {
      out.push({ ...none, changeNoiseUnits: change, leadPeak });
      continue;
    }
    const rising = p > r;
    const level = (f: number) => r + f * (p - r);
    // Walk back from the playing window to the last sample on the resting side of the
    // 10 % level, so an earlier twitch is not read as the onset; then read forward.
    const i1 = lowerBound(t, on + opt.playTo) - 1;
    let j = lowerBound(t, on + opt.playFrom);
    const onRestSide = (v: number) => (rising ? v < level(0.1) : v > level(0.1));
    while (j > i0 && !onRestSide(x[j - 1])) j--;
    const c10 = crossing(t, x, j, i1, level(0.1), rising);
    const c50 = crossing(t, x, j, i1, level(0.5), rising);
    const c90 = crossing(t, x, j, i1, level(0.9), rising);
    out.push({ t: on, measured: true, changeNoiseUnits: change, moved: true, lead10: on - c10, lead50: on - c50, lead90: on - c90, leadPeak });
  }
  return out;
}

// ---- The detector (causal) -----------------------------------------------------------

export interface EmbouchureDetectorOptions {
  /** `level`: departure from the resting baseline; `velocity`: speed of change. */
  mode?: 'level' | 'velocity';
  /** Fire when the excursion exceeds this many noise units. */
  thresholdNoiseUnits?: number;
  /** Which direction counts: +1 the signal rises into playing, -1 it falls, 0 either. */
  sign?: 1 | -1 | 0;
  /** Time constant (s) of the resting baseline (level mode). It is frozen while the
   *  detector is excited, so a held embouchure does not become the baseline. */
  baselineTau?: number;
  /** No second anchor within this many seconds of one. */
  refractory?: number;
  /** Re-arm once the excursion drops below this fraction of the threshold. */
  releaseFraction?: number;
  /** A gap between samples longer than this (s) restarts the history. */
  maxGap?: number;
  /** Noise estimator settings: the jitter's time constant (ms) and warm-up frames. */
  noiseTauMs?: number;
  warmupFrames?: number;
  /** Until the noise estimate is warm, no anchor fires. */
  fireWhileCold?: boolean;
}

/** The recent-maximum excursion (what `strength` is relative to) decays with this
 *  time constant, seconds, so a player who starts moving less is re-normalised. */
const ENVELOPE_TAU = 30;
/** Confidence at the threshold itself; it reaches 1 at twice the threshold. */
const CONFIDENCE_AT_THRESHOLD = 0.5;
const MIN_DT = 1e-6;

const DETECTOR_DEFAULTS: Required<EmbouchureDetectorOptions> = {
  mode: 'level',
  thresholdNoiseUnits: 6,
  sign: 1,
  baselineTau: 3,
  refractory: 0.25,
  releaseFraction: 0.5,
  maxGap: 0.5,
  noiseTauMs: 10000,
  warmupFrames: 30,
  fireWhileCold: false,
};

export interface EmbouchureDetector {
  /** Feed one sample of the signal. Returns an anchor when an onset is detected. */
  push(t: number, x: number): Anchor | null;
  /** The current excursion in noise units (for plots and tests). */
  excursion(): number;
  reset(): void;
}

/**
 * The causal mouth-onset detector on one scalar signal. Anchors carry the ictus
 * contract: `t` (interpolated crossing), `confidence` (how far past the threshold, 0..1),
 * `strength` (excursion against the largest recent one, 0..1+), `sharpness` (rise rate
 * at the crossing, noise units per second), `lateral` 0.
 */
export function createEmbouchureDetector(options: EmbouchureDetectorOptions = {}): EmbouchureDetector {
  const o = { ...DETECTOR_DEFAULTS, ...options };
  const ID = 's';
  let noise: NoiseEstimator = createNoiseEstimator({ tauMs: o.noiseTauMs, warmupFrames: o.warmupFrames });
  let baseline = NaN;
  let lastT = NaN;
  let lastX = NaN;
  let lastE = 0;
  let excited = false;
  let lastAnchorT = -Infinity;
  let envelope = 0;

  const restart = () => {
    baseline = NaN;
    lastT = NaN;
    lastX = NaN;
    lastE = 0;
    excited = false;
  };

  const signed = (v: number) => (o.sign === 0 ? Math.abs(v) : o.sign * v);

  return {
    push(t, x) {
      if (!Number.isFinite(x)) return null;
      if (Number.isFinite(lastT) && t - lastT > o.maxGap) restart();
      noise.push({ [ID]: x }, t * 1000);
      const sigma = noise.sigma(ID);
      const warm = noise.isWarm(ID) || o.fireWhileCold;
      if (!Number.isFinite(baseline)) baseline = x;
      let e = 0;
      if (Number.isFinite(sigma) && sigma > 0 && Number.isFinite(lastT)) {
        if (o.mode === 'level') e = signed(x - baseline) / sigma;
        else {
          const dt = t - lastT;
          // Per-frame velocity in noise units per frame, so the threshold is frame-rate
          // independent in the sense the noise itself is (jitter is per frame).
          e = dt > 0 ? signed(x - lastX) / sigma : 0;
        }
      }
      let anchor: Anchor | null = null;
      const thr = o.thresholdNoiseUnits;
      if (!excited) {
        if (warm && e >= thr && t - lastAnchorT >= o.refractory && Number.isFinite(lastT)) {
          excited = true;
          // Interpolate the crossing between the previous sample and this one.
          const f = e === lastE ? 1 : Math.min(1, Math.max(0, (thr - lastE) / (e - lastE)));
          const at = lastT + f * (t - lastT);
          const dt = Math.max(MIN_DT, t - lastT);
          if (Number.isFinite(lastAnchorT)) envelope *= Math.exp(-(at - lastAnchorT) / ENVELOPE_TAU);
          anchor = {
            t: at,
            confidence: Math.min(1, (e - thr) / thr + CONFIDENCE_AT_THRESHOLD),
            // Against the largest recent excursion: above 1 when this one is the largest.
            strength: envelope > 0 ? e / envelope : 1,
            sharpness: (e - lastE) / dt,
            lateral: 0,
          };
          envelope = Math.max(envelope, e);
          lastAnchorT = at;
        }
      } else if (e < thr * o.releaseFraction) {
        excited = false;
      }
      // Baseline: a slow EMA that only learns while the mouth is at rest.
      if (o.mode === 'level' && !excited && Number.isFinite(lastT)) {
        const dt = t - lastT;
        const a = 1 - Math.exp(-dt / o.baselineTau);
        baseline += a * (x - baseline);
      }
      if (o.mode === 'velocity' && !excited && Number.isFinite(lastT)) {
        // In velocity mode the baseline is unused; keep it at the sample for excursion().
        baseline = x;
      }
      lastT = t;
      lastX = x;
      lastE = e;
      return anchor;
    },
    excursion: () => lastE,
    reset() {
      noise = createNoiseEstimator({ tauMs: o.noiseTauMs, warmupFrames: o.warmupFrames });
      restart();
      lastAnchorT = -Infinity;
      envelope = 0;
    },
  };
}

/** Run the detector over a whole series (offline convenience for the CLI and tests). */
export function detectOnsets(t: readonly number[], x: readonly number[], options: EmbouchureDetectorOptions = {}): Anchor[] {
  const det = createEmbouchureDetector(options);
  const out: Anchor[] = [];
  for (let i = 0; i < t.length; i++) {
    const a = det.push(t[i], x[i]);
    if (a) out.push(a);
  }
  return out;
}

// ---- Matching ------------------------------------------------------------------------

export interface MatchWindow {
  /** An estimate may precede the reference by up to this (s). */
  before: number;
  /** ... and follow it by up to this (s). */
  after: number;
}

export interface Matching {
  /** Matched pairs; `lead = ref - est` (positive = the estimate came first). */
  pairs: { ref: number; est: number; lead: number }[];
  /** References with no estimate in their window. */
  missed: number[];
  /** Estimates that matched no reference. */
  extra: number[];
}

/**
 * One-to-one matching of estimates to references inside an asymmetric window: each
 * reference takes the nearest unmatched estimate in `[ref - before, ref + after]`,
 * references in time order, ties to the earlier estimate.
 */
export function matchEvents(ref: readonly number[], est: readonly number[], window: MatchWindow): Matching {
  const R = [...ref].sort((a, b) => a - b);
  const E = [...est].sort((a, b) => a - b);
  const used = new Array<boolean>(E.length).fill(false);
  const pairs: Matching['pairs'] = [];
  const missed: number[] = [];
  let j0 = 0;
  for (const r of R) {
    while (j0 < E.length && E[j0] < r - window.before) j0++;
    let best = -1;
    let bestD = Infinity;
    for (let j = j0; j < E.length && E[j] <= r + window.after; j++) {
      if (used[j]) continue;
      const d = Math.abs(E[j] - r);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best >= 0) {
      used[best] = true;
      pairs.push({ ref: r, est: E[best], lead: r - E[best] });
    } else missed.push(r);
  }
  const extra = E.filter((_, j) => !used[j]);
  return { pairs, missed, extra };
}

export interface DetectionScore {
  refs: number;
  events: number;
  hits: number;
  /** hits / refs */
  recall: number;
  /** hits / events */
  precision: number;
  lead: LeadStats;
}

export function scoreDetection(ref: readonly number[], est: readonly number[], window: MatchWindow): DetectionScore {
  const m = matchEvents(ref, est, window);
  return {
    refs: ref.length,
    events: est.length,
    hits: m.pairs.length,
    recall: ref.length ? m.pairs.length / ref.length : NaN,
    precision: est.length ? m.pairs.length / est.length : NaN,
    lead: leadStats(m.pairs.map((p) => p.lead)),
  };
}

/** Seconds of `[start, end)` spans that lie within `pad` of any of `times` — the
 *  "playing" time, against which false alarms during playing are rated per minute. */
export function coveredSeconds(times: readonly number[], pad: number, start: number, end: number): number {
  const T = [...times].sort((a, b) => a - b);
  let total = 0;
  let curStart = NaN;
  let curEnd = NaN;
  for (const t of T) {
    const a = Math.max(start, t - pad);
    const b = Math.min(end, t + pad);
    if (b <= a) continue;
    if (Number.isNaN(curStart)) [curStart, curEnd] = [a, b];
    else if (a <= curEnd) curEnd = Math.max(curEnd, b);
    else {
      total += curEnd - curStart;
      [curStart, curEnd] = [a, b];
    }
  }
  if (!Number.isNaN(curStart)) total += curEnd - curStart;
  return total;
}

/** Whether `t` lies within `pad` of any of the sorted `times`. */
export function nearAny(times: readonly number[], t: number, pad: number): boolean {
  const i = lowerBound(times, t - pad);
  return i < times.length && times[i] <= t + pad;
}
