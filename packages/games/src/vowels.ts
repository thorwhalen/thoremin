/**
 * The vowel trapezoid as a plane the voice moves a dot on (the vowel games), and back: a point on it
 * as the formants that would sound it (the playable chart).
 *
 * The vowels and their places (backness 0 front to 1 back, height 0 close to 1 open, rounding) are
 * glossa's table (`thorwhalen/glossa`, `src/lib/ipa/vowels.ts`), drawn in the IPA's own trapezoid:
 * the back edge upright, the open row half as long as the close row. The sixteen primary and
 * secondary cardinal vowels carry reference formants (F1, F2 of an adult male voice; Catford's
 * values as tabled in Wikipedia's "Formant"), and the map from formants to the chart is the
 * least-squares affine fit of the eight primary ones' positions on their formants in Bark, corrected near each
 * cardinal vowel so it passes through its place (a measured map, not a hand-tuned curve); the
 * playable chart uses its inverse. A voice whose tract is shorter (most women, all children) has every formant higher;
 * `voiceScale` divides that out (by default from the player's own F3, `createVowelCursor`).
 *
 * Pure: data and arithmetic.
 */
import { SMOOTHING_DEFAULT, smoothedAt, type CursorTuning } from './tuning';
import { createOneEuro, type OneEuroOptions } from '@thoremin/stats/smooth';
import { median } from '@thoremin/stats/quantile';
import type { CursorState, Point, PointSource } from './field';
import type { Heard } from './listen';
import { createLoudnessScale, type LoudnessScale } from './loudness';

export interface Vowel {
  ipa: string;
  /** 0 front .. 1 back. */
  backness: number;
  /** 0 close .. 1 open. */
  height: number;
  rounded: boolean;
  /** Reference formants, Hz (the cardinal vowels only). */
  f1?: number;
  f2?: number;
}

const v = (ipa: string, backness: number, height: number, rounded: boolean, f1?: number, f2?: number): Vowel => ({ ipa, backness, height, rounded, ...(f1 ? { f1, f2 } : {}) });

/** glossa's vowel table, with the cardinal vowels' reference formants. */
export const VOWELS: readonly Vowel[] = [
  v('i', 0, 0, false, 240, 2400),
  v('y', 0, 0, true, 235, 2100),
  v('ɨ', 0.5, 0, false),
  v('ʉ', 0.5, 0, true),
  v('ɯ', 1, 0, false, 300, 1390),
  v('u', 1, 0, true, 250, 595),
  v('ɪ', 0.15, 0.2, false),
  v('ʏ', 0.15, 0.2, true),
  v('ʊ', 0.85, 0.2, true),
  v('e', 0, 0.4, false, 390, 2300),
  v('ø', 0, 0.4, true, 370, 1900),
  v('ɘ', 0.5, 0.4, false),
  v('ɵ', 0.5, 0.4, true),
  v('ɤ', 1, 0.4, false, 460, 1310),
  v('o', 1, 0.4, true, 360, 640),
  v('ə', 0.5, 0.55, false),
  v('ɛ', 0, 0.7, false, 610, 1900),
  v('œ', 0, 0.7, true, 585, 1710),
  v('ɜ', 0.5, 0.7, false),
  v('ɞ', 0.5, 0.7, true),
  v('ʌ', 1, 0.7, false, 600, 1170),
  v('ɔ', 1, 0.7, true, 500, 700),
  v('æ', 0.1, 0.85, false),
  v('ɐ', 0.5, 0.85, false),
  v('a', 0, 1, false, 850, 1610),
  v('ɶ', 0, 1, true, 820, 1530),
  v('ɑ', 1, 1, false, 750, 940),
  v('ɒ', 1, 1, true, 700, 760),
];

/** The vowels a vowel game uses by default: the eight primary cardinal vowels. */
export const PRIMARY_VOWELS = ['i', 'e', 'ɛ', 'a', 'ɑ', 'ɔ', 'o', 'u'] as const;

export const vowelByIpa = (ipa: string): Vowel | undefined => VOWELS.find((x) => x.ipa === ipa);


/** The plane's margins around the trapezoid: thin, so the chart fills the stage (the labels still fit inside). */
const PAD = { x0: 0.03, x1: 0.97, y0: 0.08, y1: 0.92 };

/** A place on the IPA trapezoid (backness, height) as a point on the plane (y up: close at the top). */
export function chartPoint(backness: number, height: number): Point {
  // The front edge leans in by half the width from close to open; the back edge stays upright.
  const x = 0.5 * height + backness * (1 - 0.5 * height);
  return { x: PAD.x0 + x * (PAD.x1 - PAD.x0), y: PAD.y1 - height * (PAD.y1 - PAD.y0) };
}

/** The trapezoid's corners, clockwise from close front. */
export const TRAPEZOID: readonly Point[] = [chartPoint(0, 0), chartPoint(1, 0), chartPoint(1, 1), chartPoint(0, 1)];

/** Traunmüller's Bark, and back. */
export const bark = (hz: number): number => (26.81 * hz) / (1960 + hz) - 0.53;
export const hzOfBark = (b: number): number => (1960 * (b + 0.53)) / (26.28 - b);

/** Solve a 3x3 system by Cramer's rule (the normal equations of a two-feature line). */
function solve3(m: number[][], r: number[]): number[] {
  const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  return [0, 1, 2].map((k) => det(m.map((row, i) => row.map((x, j) => (j === k ? r[i] : x)))) / d);
}

/** x and y on the plane as affine functions of (Bark F1, Bark F2), fitted on the cardinal vowels. */
function fitMap(vowels: readonly Vowel[]): { x: number[]; y: number[] } {
  const rows = vowels.filter((w) => w.f1 && w.f2).map((w) => ({ b1: bark(w.f1!), b2: bark(w.f2!), p: chartPoint(w.backness, w.height) }));
  const ata = [
    [rows.length, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atx = [0, 0, 0];
  const aty = [0, 0, 0];
  for (const { b1, b2, p } of rows) {
    const f = [1, b1, b2];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) if (i + j > 0) ata[i][j] += f[i] * f[j];
      atx[i] += f[i] * p.x;
      aty[i] += f[i] * p.y;
    }
  }
  return { x: solve3(ata, atx), y: solve3(ata, aty) };
}

/**
 * The vowels the map is fitted and anchored on: the eight primary cardinals. A secondary one
 * shares its primary's place on the chart with a different F2 (rounding lowers it), and anchoring
 * both to one place would fold the map; left out, it lands where its sound puts it.
 */
const ANCHOR_VOWELS = VOWELS.filter((w) => (PRIMARY_VOWELS as readonly string[]).includes(w.ipa));

const MAP = fitMap(ANCHOR_VOWELS);

/** Width of the correction's reach, Bark: a reference vowel pulls the map within about this distance. */
const REACH_BARK = 2;

const affine = (b1: number, b2: number): Point => ({ x: MAP.x[0] + MAP.x[1] * b1 + MAP.x[2] * b2, y: MAP.y[0] + MAP.y[1] * b1 + MAP.y[2] * b2 });

/** A Gaussian kernel over Bark distance. */
const kernel = (d2: number) => Math.exp(-d2 / (2 * REACH_BARK * REACH_BARK));

/** Solve a small dense system by Gaussian elimination with partial pivoting. */
function solveDense(m: number[][], r: number[]): number[] {
  const n = r.length;
  const a = m.map((row, i) => [...row, r[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(a[i][c]) > Math.abs(a[piv][c])) piv = i;
    [a[c], a[piv]] = [a[piv], a[c]];
    for (let i = c + 1; i < n; i++) {
      const f = a[i][c] / a[c][c];
      for (let j = c; j <= n; j++) a[i][j] -= f * a[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let acc = a[i][n];
    for (let j = i + 1; j < n; j++) acc -= a[i][j] * x[j];
    x[i] = acc / a[i][i];
  }
  return x;
}

/**
 * What the affine fit leaves at each reference vowel, interpolated by Gaussian radial basis
 * functions (weights solved once, so the map passes exactly through every reference vowel's chart
 * place) and fading to the plain fit away from them: a textbook [e] lands on [e]'s place.
 */
const ANCHORS = (() => {
  const refs = ANCHOR_VOWELS.map((w) => {
    const b1 = bark(w.f1!);
    const b2 = bark(w.f2!);
    const fit = affine(b1, b2);
    const at = chartPoint(w.backness, w.height);
    return { b1, b2, rx: at.x - fit.x, ry: at.y - fit.y };
  });
  const k = refs.map((p) => refs.map((q) => kernel((p.b1 - q.b1) ** 2 + (p.b2 - q.b2) ** 2)));
  const wx = solveDense(k, refs.map((p) => p.rx));
  const wy = solveDense(k, refs.map((p) => p.ry));
  return refs.map((p, i) => ({ b1: p.b1, b2: p.b2, wx: wx[i], wy: wy[i] }));
})();

function mapBark(b1: number, b2: number): Point {
  const p = affine(b1, b2);
  for (const a of ANCHORS) {
    const w = kernel((b1 - a.b1) ** 2 + (b2 - a.b2) ** 2);
    p.x += w * a.wx;
    p.y += w * a.wy;
  }
  return p;
}

/** Where formants F1, F2 (Hz, already divided by the voice's scale) fall on the plane. */
export function vowelPoint(f1: number, f2: number): Point {
  return mapBark(bark(f1), bark(f2));
}

/**
 * The formants that sound a point of the plane: the map inverted by Newton's method from the
 * affine fit's exact inverse; F3 from a rule of thumb that rises with F2. For the playable chart:
 * a synth fed these says the vowel drawn there.
 */
export function formantsAt(p: Point, voiceScale = 1): { f1: number; f2: number; f3: number } {
  const [x0, x1, x2] = MAP.x;
  const [y0, y1, y2] = MAP.y;
  const det = x1 * y2 - x2 * y1;
  let b1 = ((p.x - x0) * y2 - x2 * (p.y - y0)) / det;
  let b2 = (x1 * (p.y - y0) - (p.x - x0) * y1) / det;
  const h = 1e-3;
  for (let it = 0; it < 12; it++) {
    const q = mapBark(b1, b2);
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    if (Math.hypot(ex, ey) < 1e-6) break;
    const qa = mapBark(b1 + h, b2);
    const qb = mapBark(b1, b2 + h);
    const j11 = (qa.x - q.x) / h;
    const j21 = (qa.y - q.y) / h;
    const j12 = (qb.x - q.x) / h;
    const j22 = (qb.y - q.y) / h;
    const d = j11 * j22 - j12 * j21;
    if (!(Math.abs(d) > 1e-12)) break;
    b1 -= (ex * j22 - j12 * ey) / d;
    b2 -= (j11 * ey - ex * j21) / d;
  }
  const f1 = hzOfBark(Math.max(1, Math.min(10, b1)));
  const f2 = Math.max(f1 + 150, hzOfBark(Math.max(4, Math.min(16, b2))));
  return { f1: f1 * voiceScale, f2: f2 * voiceScale, f3: (2200 + 0.3 * f2) * voiceScale };
}

/** Where a vowel of the table is drawn and aimed at: its chart place. */
export const vowelAt = (w: Vowel): Point => chartPoint(w.backness, w.height);

/** The vowel of `set` whose chart place is nearest a point. */
export function nearestVowel(p: Point, set: readonly Vowel[] = VOWELS): Vowel {
  let best = set[0];
  let bestD = Infinity;
  for (const w of set) {
    const q = vowelAt(w);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

/** The chart's marks: each vowel's symbol, the unrounded one left of its place and the rounded right (the IPA's way). */
export function vowelMarks(set: readonly Vowel[] = VOWELS): (Point & { label: string })[] {
  return set.map((w) => {
    const q = vowelAt(w);
    const pair = set.some((o) => o !== w && o.backness === w.backness && o.height === w.height);
    return { x: q.x + (pair ? (w.rounded ? 0.025 : -0.025) : 0), y: q.y, label: w.ipa };
  });
}

/**
 * A player's own vowel space, fitted to the chart's: every voice's vowels sit inside the textbook
 * cardinal corners (a sung [i] has a higher F1 and a lower F2 than Catford's), so the textbook map
 * puts a real [i] on [e] and a real [u] on [o]. A few calibration vowels, each the player's
 * formants at a known chart place, fit an affine map from the player's (Bark F1, Bark F2) to the
 * reference voice's (speaker normalisation; exact with three vowels, least squares with more).
 */
export interface VoiceSample extends Formant2 {
  /** The chart place the player was asked for. */
  place: Point;
}
export interface Formant2 {
  f1: number;
  f2: number;
}
/** Reference Bark F1 and F2 as affine functions of the player's: `[c0, c1 (of b1), c2 (of b2)]`. */
export interface VoiceMap {
  b1: [number, number, number];
  b2: [number, number, number];
}

/** The vowels a calibration asks for by default: the three corners, as chart places. */
export const CALIBRATION_VOWELS: readonly { ipa: string; word: string; place: Point }[] = [
  { ipa: 'i', word: 'ee', place: chartPoint(0, 0) },
  { ipa: 'u', word: 'oo', place: chartPoint(1, 0) },
  { ipa: 'ä', word: 'ah', place: chartPoint(0.5, 1) },
];

/** The least spread of the calibration vowels a fit accepts (see `fitVoice`), Bark^4. */
const MIN_SPREAD = 0.05;

export function fitVoice(samples: readonly VoiceSample[]): VoiceMap {
  if (samples.length < 3) throw new Error(`fitVoice: needs at least three calibration vowels, got ${samples.length}`);
  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const at1 = [0, 0, 0];
  const at2 = [0, 0, 0];
  for (const s of samples) {
    const ref = formantsAt(s.place);
    const f = [1, bark(s.f1), bark(s.f2)];
    const r1 = bark(ref.f1);
    const r2 = bark(ref.f2);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ata[i][j] += f[i] * f[j];
      at1[i] += f[i] * r1;
      at2[i] += f[i] * r2;
    }
  }
  // The samples' spread in Bark must have area: three vowels sung alike (or on one line) leave the
  // map undetermined. The determinant of their 2x2 scatter, Bark^4; real corners give tens.
  const n = samples.length;
  const m1 = ata[0][1] / n;
  const m2 = ata[0][2] / n;
  const spread = (ata[1][1] / n - m1 * m1) * (ata[2][2] / n - m2 * m2) - (ata[1][2] / n - m1 * m2) ** 2;
  if (!(spread > MIN_SPREAD)) throw new Error('fitVoice: the calibration vowels are too alike to fit a map (sing each one clearly different)');
  const b1 = solve3(ata, at1);
  const b2 = solve3(ata, at2);
  return { b1: b1 as VoiceMap['b1'], b2: b2 as VoiceMap['b2'] };
}

/**
 * One calibration vowel from what was heard while the player held it: the median F1 and F2 of the
 * windows loud enough to be a vowel (the loudest half), or null when too few were.
 */
export function voiceSampleOf(frames: readonly { f1: number | null; f2: number | null; rms: number }[], place: Point, { minFrames = 20 } = {}): VoiceSample | null {
  const ok = frames.filter((f): f is { f1: number; f2: number; rms: number } => f.f1 !== null && f.f2 !== null);
  if (ok.length < minFrames) return null;
  const loudest = median(ok.map((f) => f.rms));
  const held = ok.filter((f) => f.rms >= loudest);
  return { place, f1: median(held.map((f) => f.f1)), f2: median(held.map((f) => f.f2)) };
}

/** A player's formants as the reference voice's (Hz), through their fitted map. */
export function applyVoice(m: VoiceMap, f1: number, f2: number): Formant2 {
  const p1 = bark(f1);
  const p2 = bark(f2);
  return { f1: hzOfBark(m.b1[0] + m.b1[1] * p1 + m.b1[2] * p2), f2: hzOfBark(m.b2[0] + m.b2[1] * p1 + m.b2[2] * p2) };
}

/** The voice's scale: how much higher its formants are than the reference (adult male) voice's. */
export const VOICE_SCALES = { auto: NaN, lower: 1, higher: 1.15, child: 1.3 } as const;
export type VoiceKind = keyof typeof VOICE_SCALES;

/** The reference voice's F3 (the cardinal recordings' median), Hz: the auto scale is the player's median F3 over it. */
export const REFERENCE_F3 = 2700;

export interface VowelCursorOptions {
  voice?: VoiceKind;
  /** A window counts as a vowel only above this share of the player's loudness range (0..1). */
  gate?: number;
  /** ...and above this rms. */
  minRms?: number;
  loudness?: LoudnessScale;
  /** The player's fitted vowel space (`fitVoice`); replaces `voice` when given. */
  calibration?: VoiceMap;
  /** A gap shorter than this keeps the dot live, seconds. */
  holdS?: number;
  /** The point is the median of this many windows' (10 ms each). */
  medianOf?: number;
  smooth?: OneEuroOptions;
  /** The player's smoothing, 0..1 (`tuning`): scales the filter and the median; 0.5 is the defaults. */
  smoothing?: number;
}

/** Smoothing measured on sung vowels (`scripts/audio_games/measure_vowels.ts`, VocalSet): a 150 ms median and a slow 1-euro filter keep the dot's 90th-percentile step per 10 ms near 1 % of the chart, at about 75 ms of lag. The gate is low because a sung [u] sits some 10 dB under an [a] (0.16 of the range an [i] and [a] set). */
export const VOWEL_CURSOR_DEFAULTS = { voice: 'auto' as VoiceKind, gate: 0.15, minRms: 0.004, holdS: 0.2, medianOf: 15, smooth: { minCutoff: 0.5, beta: 0.2 } as OneEuroOptions };

export interface VowelCursor extends PointSource {
  /** The voice scale in use (the auto one once it has heard enough). */
  scale(): number;
}

/** The voice's vowel as a point on the trapezoid, when it is loud enough to be a vowel. */
export function createVowelCursor(options: VowelCursorOptions = {}): VowelCursor {
  const o = { ...VOWEL_CURSOR_DEFAULTS, ...options };
  const loudness = o.loudness ?? createLoudnessScale();
  // The median's length doubles from smoothing 0.5 to 1 and halves from 0.5 to 0.
  const medianAt = (s: number | undefined) => (s === undefined ? o.medianOf : Math.max(1, Math.round(o.medianOf * 2 ** ((s - SMOOTHING_DEFAULT) * 2))));
  let smoothing = o.smoothing;
  let medianOf = medianAt(smoothing);
  const filter = () => createOneEuro(smoothedAt(o.smooth, smoothing));
  let sx = filter();
  let sy = filter();
  const f3s: number[] = [];
  let scale = Number.isNaN(VOICE_SCALES[o.voice]) ? 1 : VOICE_SCALES[o.voice];
  const recent: Point[] = [];
  let last: CursorState | null = null;
  let lastVoiced = -Infinity;
  return {
    scale: () => scale,
    tune(t: CursorTuning) {
      if (t.smoothing === undefined || t.smoothing === smoothing) return;
      smoothing = t.smoothing;
      medianOf = medianAt(smoothing);
      sx = filter();
      sy = filter();
    },
    push(heard: Heard, now: number) {
      for (const f of heard.formants ?? []) {
        if (f.f1 === null || f.f2 === null || f.rms < o.minRms) continue;
        const level = loudness.push(f.t, f.rms);
        if (level < o.gate) continue;
        if (Number.isNaN(VOICE_SCALES[o.voice]) && f.f3 !== null) {
          f3s.push(f.f3);
          if (f3s.length > 600) f3s.shift();
          if (f3s.length >= 50) scale = Math.max(0.9, Math.min(1.4, median(f3s) / REFERENCE_F3));
        }
        if (f.t - lastVoiced > o.holdS) {
          sx.reset();
          sy.reset();
          recent.length = 0;
        }
        lastVoiced = f.t;
        const ref = o.calibration ? applyVoice(o.calibration, f.f1, f.f2) : { f1: f.f1 / scale, f2: f.f2 / scale };
        const p = vowelPoint(ref.f1, ref.f2);
        // The median of the last few windows: a window whose F2 was lost (F3 read in its place)
        // throws the point across the chart, and a few such in a row are common in back vowels.
        recent.push(p);
        while (recent.length > medianOf) recent.shift();
        const mx = median(recent.map((q) => q.x));
        const my = median(recent.map((q) => q.y));
        const clamp = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);
        last = { x: clamp(sx.push(f.t, mx)), y: clamp(sy.push(f.t, my)), live: true };
      }
      if (last && now - lastVoiced > o.holdS) last = { ...last, live: false };
      return last;
    },
  };
}

/** How hard Vowel Pop is: the balloons' radius (units of the height; one speaker's vowels sit 0.03 to 0.17 off the textbook's places) and the hold. */
export const VOWEL_POP_LEVELS = {
  easy: { r: 0.18, holdS: 0.5 },
  normal: { r: 0.14, holdS: 0.7 },
  hard: { r: 0.09, holdS: 1 },
} as const;

/** A Vowel Pop course: the given vowels as labelled balloons at their places, in a seeded order. */
export function vowelCourse(opts: { vowels?: readonly string[]; r: number; seed?: number; rounds?: number }): { x: number; y: number; r: number; label: string }[] {
  const known = (opts.vowels ?? PRIMARY_VOWELS).map((ipa) => vowelByIpa(ipa)).filter((w): w is Vowel => !!w);
  // None of the asked vowels known (a spec's typo): the primary eight rather than an empty round.
  const set = known.length ? known : PRIMARY_VOWELS.map((ipa) => vowelByIpa(ipa)!);
  let s = (opts.seed ?? 1) >>> 0;
  const rand = () => ((s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) >>> 0) / 4294967296);
  const out: { x: number; y: number; r: number; label: string }[] = [];
  for (let k = 0; k < (opts.rounds ?? 1); k++) {
    const order = [...set].sort(() => rand() - 0.5);
    for (const w of order) out.push({ ...vowelAt(w), r: opts.r, label: w.ipa });
  }
  return out;
}
