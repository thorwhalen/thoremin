/**
 * Turn a real-versus-air take (#247) into labelled, aligned pairs — the library half,
 * with no side effects on import.
 *
 * ## What a take holds, and what this makes of it
 *
 * A real-versus-air routine (`src/app/enroll/realVsAirCues.ts`) asks the player for the
 * same phrase twice, to the same click: once on a real surface or instrument, once in
 * the air. Its take is one folder on one clock (`docs/design/recording-v2.md`): the
 * clean camera, the hand feature vectors (`features.jsonl`), the microphone
 * (`mic.wav`), and the annotations — an interval per cue and a point per click
 * (`annotations.jsonl`) — plus the routine's own cue specs in the manifest's `meta`.
 *
 * This joins them. Per phrase and per beat:
 *
 * - the **real** half gets its label from the sound: the microphone onset nearest the
 *   beat's click, how loud it was (dBFS), and its pitch content (a 12-bin chroma);
 * - the **air** half has no sound, so its label is the click shifted by the player's own
 *   lag, measured on the real half of the same phrase (a player who lands 30 ms after
 *   the click on the table is assumed to intend the same in the air), and it inherits
 *   the real half's level and chroma beat for beat;
 * - every time label is given twice, on the microphone's clock and on the feature rows'
 *   (below: which is which, and why the second is the one to train on);
 * - the feature rows of each half are sliced out beside the pairs, rows untouched, so
 *   anything computed later joins back on `t`.
 *
 * ## Three clocks, and which one each field is on
 *
 * - The **engine clock** (`performance.now()`): the clicks, the cue intervals.
 * - The **mic clock**: `t0` plus the time into the microphone file. It is NOT the
 *   engine clock: the file starts when the browser's recorder did, some tens of ms after
 *   `t0`, plus the input latency and codec priming, and the microphone's own hardware
 *   clock drifts against `performance.now()` (tens of ppm, several ms over a routine).
 *   `onset`, `lagMs` and the air `intended` (a click plus a lag measured on this clock)
 *   are mic-clock values: `lagMs` is the player's lag PLUS the microphone's offset.
 * - The **row clock**: the feature rows' `t`, the engine tick at which each camera frame
 *   was processed, so it trails the capture by the camera pipeline's lag.
 *
 * What a model trained on the rows needs is the label on the ROW clock, and the slates
 * measure exactly that mapping: a clap is heard (mic clock) and seen (the row with the
 * smallest `hand.pair.distance`, row clock) at the same physical instant, so the median
 * difference is the mic-to-row offset, camera lag included, microphone start offset
 * included. The routine claps at its start and again at its end; two slates give the
 * drift too (`micToRows`). The `*Row` fields (`onsetRow`, `intendedRow`) apply it; the
 * mic-clock fields are kept beside them, raw, so a consumer can see what was corrected.
 * The seen clap is interpolated between rows (a parabola through the smallest
 * `hand.pair.distance` and its neighbours), so it is not quantised to a frame; a slate
 * is used only when enough claps agree, and a drift no clock could have is refused (see
 * `MIN_SLATE_CLAPS`, `MAX_SLATE_MAD_MS`, `MAX_DRIFT_MS_PER_S`).
 *
 * ## Onsets
 *
 * A union of two rise detectors, on the level and on the first difference: the level
 * misses a strum over a chord still ringing, the difference misses a low knock on wood.
 * `scripts/cue/README.md` has the measurements; {@link OnsetOptions.emphasis} the why.
 *
 * Nothing written here is ever committed: a take is the player's body and room, and it
 * goes under the app-data directory (`~/.local/share/thoremin/`), never the repository.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { resolveIntervals } from '@/taglog/affordances/resolve';
import { CueSchema, clickPlan, type Cue } from '@/enroll';
import { cueWindows, edgeEventsFromRows, findStem, sealOpenEnded, type CueWindow } from '../lib_trainer_take';
import { dataRoot } from '../air/lib_air_paths';

export const PAIRS_VERSION = 1;

// ---- Audio ---------------------------------------------------------------------

export interface Wav {
  sampleRate: number;
  /** Mono (channels averaged), -1..1. */
  pcm: Float32Array;
}

/** Parse a RIFF/WAVE file: 16/24/32-bit integer PCM or 32-bit float, any channel count,
 *  WAVE_FORMAT_EXTENSIBLE included. Channels are averaged to mono. */
export function parseWav(bytes: Uint8Array): Wav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: { offset: number; size: number } | null = null;
  for (let o = 12; o + 8 <= bytes.byteLength; ) {
    const id = tag(o);
    const size = view.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the sub-format GUID.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
      fmt = { format, channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === 'data') {
      data = { offset: body, size: Math.min(size, bytes.byteLength - body) };
    }
    o = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAVE file without a fmt or data chunk');
  const { format, channels, sampleRate, bits } = fmt;
  const bytesPer = bits / 8;
  const frames = Math.floor(data.size / (bytesPer * channels));
  const read = (o: number): number => {
    if (format === 3 && bits === 32) return view.getFloat32(o, true);
    if (format === 1 && bits === 16) return view.getInt16(o, true) / 32768;
    if (format === 1 && bits === 24) {
      const v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
      return (v & 0x800000 ? v - 0x1000000 : v) / 8388608;
    }
    if (format === 1 && bits === 32) return view.getInt32(o, true) / 2147483648;
    throw new Error(`unsupported WAVE encoding: format ${format}, ${bits} bits`);
  };
  const pcm = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += read(data.offset + (i * channels + c) * bytesPer);
    pcm[i] = sum / channels;
  }
  return { sampleRate, pcm };
}

export interface OnsetOptions {
  /** Envelope hop and window, ms. */
  hopMs?: number;
  windowMs?: number;
  /** An onset's envelope must exceed `noiseFactor` × the noise floor (the envelope's
   *  `floorPercentile`: a take is mostly quiet, but a strummed phrase rings for a third
   *  of it, so the median is not the floor)... */
  noiseFactor?: number;
  floorPercentile?: number;
  /** ...and `rise` × its own maximum over the previous `lookbackMs`. */
  rise?: number;
  lookbackMs?: number;
  /** No second onset sooner than this after one. */
  refractoryMs?: number;
  /**
   * Which signal(s) to detect on: `'level'` (the signal), `'difference'` (its first
   * difference, `x[n] - x[n-1]`), or `'both'` (the union, the default). Neither alone is
   * enough, and each fails where the other works:
   *
   * - The difference weighs a partial by its frequency. A string's ringing is its low
   *   partials and a pluck's attack its high ones, so a strum over a chord still ringing
   *   from the last one is a large rise in the difference and hardly any in the level
   *   (measured: level 0/16 strums at a 1.5 s ring, difference 16/16).
   * - But a knock on wood with a fingertip is mostly 100 to 500 Hz, which the difference
   *   attenuates below the room's noise (measured: difference 0/16 knocks at 90-800 Hz
   *   even at -20 dBFS in a -50 dBFS room, level 16/16).
   *
   * The union takes the earliest onset of each cluster within `refractoryMs`.
   */
  emphasis?: 'both' | 'level' | 'difference';
  /** The difference path's own window and rise (see {@link DIFFERENCE_DEFAULTS}). */
  differenceWindowMs?: number;
  differenceRise?: number;
}

export const ONSET_DEFAULTS: Required<OnsetOptions> = {
  hopMs: 1,
  windowMs: 5,
  // 8 dB over the floor. Measured (a -50 dBFS noise room): taps peaking at -34 dBFS are
  // found at 2.5 and not at 4, and a minute of noise alone gives no onset at either,
  // because the rise test below is what rejects noise. Not lower: at SNRs under ~10 dB a
  // tap is indistinguishable from the room, and the pairing names unheard beats.
  noiseFactor: 2.5,
  floorPercentile: 0.05,
  // 6 dB over the last 30 ms. 1.8 found no more taps and lost half the hits on dense
  // real drum audio to early triggers inside the refractory window.
  rise: 2,
  lookbackMs: 30,
  refractoryMs: 80,
  emphasis: 'both',
  // A strum spread over 30 to 50 ms (an ordinary downstrum) is six small attacks, not
  // one: a 10 ms window sums them and a 1.6 rise accepts the sum. Measured: 16/16 at
  // 8/30/50 ms spreads and 0.6/1.5 s rings (5 ms and 2: 10-11/16 at 30-50 ms), and
  // still no onset in a minute of noise.
  differenceWindowMs: 10,
  differenceRise: 1.6,
};

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Onset times (seconds from the buffer start), on the signal and on its first
 * difference (see {@link OnsetOptions.emphasis}), merged.
 */
export function detectOnsets(signal: Float32Array, sampleRate: number, options: OnsetOptions = {}): number[] {
  const o = { ...ONSET_DEFAULTS, ...options };
  const found: number[] = [];
  if (o.emphasis !== 'difference') found.push(...riseOnsets(signal, sampleRate, o));
  if (o.emphasis !== 'level') {
    const diff = new Float32Array(signal.length);
    for (let i = 1; i < signal.length; i++) diff[i] = signal[i] - signal[i - 1];
    found.push(...riseOnsets(diff, sampleRate, { ...o, windowMs: o.differenceWindowMs, rise: o.differenceRise }));
  }
  found.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of found) if (out.length === 0 || t - out[out.length - 1] >= o.refractoryMs / 1000) out.push(t);
  return out;
}

/**
 * One detection path: moments the RMS envelope of `pcm` rises above the noise floor AND
 * above `rise` times its own MAXIMUM over the previous `lookbackMs`. Against the recent
 * maximum, not the minimum, because a chord's partials beat against each other: its
 * envelope dips and recovers every few tens of ms, and each recovery is a rise against
 * the dip but never against the last peak. A new strum or tap clears the last peak. Each
 * onset is placed at the attack's first sample: the first to exceed both a quarter of
 * the attack's peak and 1.5 times the loudest sample before it.
 */
function riseOnsets(pcm: Float32Array, sampleRate: number, o: Required<OnsetOptions>): number[] {
  const hop = Math.max(1, Math.round((o.hopMs / 1000) * sampleRate));
  const win = Math.max(hop, Math.round((o.windowMs / 1000) * sampleRate));
  const env: number[] = [];
  for (let start = 0; start + win <= pcm.length; start += hop) {
    let e = 0;
    for (let i = start; i < start + win; i++) e += pcm[i] * pcm[i];
    env.push(Math.sqrt(e / win));
  }
  const sorted = [...env].sort((a, b) => a - b);
  const floor = Math.max(1e-5, sorted[Math.floor(o.floorPercentile * (sorted.length - 1))] ?? 0);
  const lookback = Math.max(1, Math.round(o.lookbackMs / o.hopMs));
  const lookbackSamples = Math.round((o.lookbackMs / 1000) * sampleRate);
  const refractory = (o.refractoryMs / 1000) * sampleRate;
  const out: number[] = [];
  let last = -Infinity;
  // The comparison windows must END before window j starts: with a 1 ms hop over a 5 ms
  // window, window j-1 already holds four fifths of j's attack, and a rise measured
  // against it is a rise of a fifth.
  const winHops = Math.ceil(win / hop);
  for (let j = lookback + winHops; j < env.length; j++) {
    if (env[j] < o.noiseFactor * floor) continue;
    let before = 0;
    for (let k = j - winHops - lookback; k <= j - winHops; k++) before = Math.max(before, env[k]);
    if (env[j] < o.rise * Math.max(before, floor)) continue;
    // Place it: search the attack from one window before window j (an attack too quiet
    // to trigger the window it began in is still where it began).
    const from = Math.max(0, j * hop - win);
    let prior = 0;
    for (let i = Math.max(0, from - lookbackSamples); i < from; i++) prior = Math.max(prior, Math.abs(pcm[i]));
    let peak = 0;
    for (let i = from; i < Math.min(pcm.length, from + win + Math.round(0.01 * sampleRate)); i++) peak = Math.max(peak, Math.abs(pcm[i]));
    const threshold = Math.max(peak / 4, 1.5 * prior);
    let at = from;
    while (at < pcm.length - 1 && Math.abs(pcm[at]) < threshold) at++;
    if (at - last < refractory) continue;
    out.push(at / sampleRate);
    last = at;
  }
  return out;
}

/** Peak level (dBFS) over `windowMs` from `tSec`. */
export function levelDb(pcm: Float32Array, sampleRate: number, tSec: number, windowMs = 30): number {
  const a = Math.max(0, Math.round(tSec * sampleRate));
  const b = Math.min(pcm.length, a + Math.round((windowMs / 1000) * sampleRate));
  let peak = 0;
  for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/** Amplitude of `freq` over `pcm[start, start+len)` (Goertzel). */
function toneAmplitude(pcm: Float32Array, sampleRate: number, start: number, len: number, freq: number): number {
  const s = Math.max(0, start);
  const end = Math.min(pcm.length, start + len);
  const n = end - s;
  if (n <= 0) return 0;
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let i = s; i < end; i++) {
    const s0 = pcm[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * (i - s)) / n)) + coeff * s1 - s2; // Hann window
    s2 = s1;
    s1 = s0;
  }
  return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))) / n;
}

export interface ChromaOptions {
  /** Skip the attack (it is broadband) and read the ringing part. */
  startMs?: number;
  lengthMs?: number;
  /** The MIDI range read (E2..E6 covers a guitar). */
  lowMidi?: number;
  highMidi?: number;
}

/**
 * Pitch content after an onset: the energy at every semitone from `lowMidi` to
 * `highMidi`, folded into 12 pitch classes (C = 0) and scaled so the largest is 1. For
 * one note its argmax is the pitch class; for a chord it is the chord's pitch set, which
 * is what an air strum inherits. Coarse by design: a label, not a transcription.
 */
export function chroma(pcm: Float32Array, sampleRate: number, tSec: number, options: ChromaOptions = {}): number[] {
  const { startMs = 20, lengthMs = 200, lowMidi = 40, highMidi = 88 } = options;
  const start = Math.round((tSec + startMs / 1000) * sampleRate);
  const len = Math.round((lengthMs / 1000) * sampleRate);
  const bins = new Array<number>(12).fill(0);
  for (let m = lowMidi; m <= highMidi; m++) {
    const a = toneAmplitude(pcm, sampleRate, start, len, 440 * 2 ** ((m - 69) / 12));
    bins[m % 12] += a * a;
  }
  const max = Math.max(...bins);
  return bins.map((b) => (max > 0 ? Math.round((b / max) * 1000) / 1000 : 0));
}

/**
 * Match each click to at most one event within `maxDist` (seconds), nearest pairs first,
 * each event used once. Returns, per click, the matched event or null.
 */
export function matchToClicks(clicks: readonly number[], events: readonly number[], maxDist: number): (number | null)[] {
  const pairs: { c: number; e: number; d: number }[] = [];
  clicks.forEach((ct, c) =>
    events.forEach((et, e) => {
      const d = Math.abs(et - ct);
      if (d <= maxDist) pairs.push({ c, e, d });
    }),
  );
  pairs.sort((a, b) => a.d - b.d);
  const out: (number | null)[] = clicks.map(() => null);
  const used = new Set<number>();
  for (const p of pairs) {
    if (out[p.c] !== null || used.has(p.e)) continue;
    out[p.c] = events[p.e];
    used.add(p.e);
  }
  return out;
}

/**
 * The player's lag behind a regular click grid (seconds), from where the events fall in
 * the beat: a circular mean of their phases, read in (-1/4, 3/4] of a beat. Null when the
 * phases do not agree (fewer than 3 events, or a resultant under 0.5).
 *
 * Why it exists: the lag can be most of a beat. The click reaches the player's ears
 * through whatever they wear, and Bluetooth headphones add 150 to 300 ms, steadily; add
 * the player's own lag and a tap can land nearer the NEXT click than its own. Matching
 * each click to the nearest onset would then pair every tap with the wrong beat. So the
 * lag is estimated first, from the grid alone, and the matching is done around it.
 */
export function gridLag(clicks: readonly number[], events: readonly number[], beatS: number): number | null {
  if (clicks.length === 0 || events.length < 3 || !(beatS > 0)) return null;
  const first = clicks[0];
  const last = clicks[clicks.length - 1];
  let x = 0;
  let y = 0;
  let n = 0;
  for (const e of events) {
    if (e < first - beatS / 4 || e > last + (3 * beatS) / 4) continue;
    const phase = (2 * Math.PI * (e - first)) / beatS;
    x += Math.cos(phase);
    y += Math.sin(phase);
    n++;
  }
  if (n < 3 || Math.hypot(x, y) / n < 0.5) return null;
  let lag = (Math.atan2(y, x) / (2 * Math.PI)) * beatS; // (-beat/2, beat/2]
  if (lag <= -beatS / 4) lag += beatS;
  return lag;
}

/** Match events to clicks around the player's grid lag ({@link gridLag}): each click
 *  takes the nearest event within half a beat of `click + lag`. */
export function matchOnGrid(clicks: readonly number[], events: readonly number[], beatS: number): (number | null)[] {
  const lag = gridLag(clicks, events, beatS) ?? 0;
  return matchToClicks(clicks.map((c) => c + lag), events, beatS / 2);
}

// ---- The take --------------------------------------------------------------------

export interface TakeClick {
  /** Absolute engine-clock seconds. */
  t: number;
  kind: 'count' | 'beat';
}

export interface FeatureRow {
  tick: number;
  t: number;
  key: string;
  value: unknown;
}

export interface Take {
  dir: string;
  stem: string;
  t0: number;
  /** The routine's cues, from the manifest (the take describes itself). */
  cues: Cue[];
  windows: CueWindow[];
  clicks: TakeClick[];
  /** Per cue id: `enough` / `cannot` / `skipped`. */
  outcomes: Record<string, string>;
  /** The microphone WAV's path, if the take has one. */
  micWav: string | null;
  /** The native microphone file (WebM), if any: the fallback when the WAV is missing. */
  micNative: string | null;
  /** The microphone's device name as the browser reported it, if recorded. */
  micDevice: string | null;
  featuresPath: string;
}

function parseJsonl<T>(text: string, what: string): T[] {
  const out: T[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      throw new Error(`${what}:${i + 1}: not JSON`);
    }
  });
  return out;
}

/** Read a take folder: the manifest (t0, the routine's cues), the annotations (cue
 *  intervals, clicks, verdicts), and where the microphone and features are. */
export function readTake(dir: string): Take {
  const stem = findStem(dir);
  const manifestPath = join(dir, `${stem}.manifest.json`);
  if (!existsSync(manifestPath)) throw new Error(`${manifestPath} is missing`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    t0: number;
    streams: { file: string; kind: string; device?: string }[];
    meta?: { trainer?: { cues?: unknown[] } };
  };
  const rawCues = manifest.meta?.trainer?.cues;
  if (!Array.isArray(rawCues) || rawCues.length === 0) {
    throw new Error(
      `${manifestPath}: no trainer cues in meta. This take was not recorded by a real-vs-air routine (or by a build older than #247), so its cues cannot be paired.`,
    );
  }
  const cues = rawCues.map((c) => CueSchema.parse(c));

  const annPath = join(dir, `${stem}.annotations.jsonl`);
  if (!existsSync(annPath)) throw new Error(`${annPath} is missing: the cue intervals and the clicks live there`);
  const rows = parseJsonl<Record<string, unknown>>(readFileSync(annPath, 'utf8'), annPath);
  const anchor = rows[0];
  if (!anchor || anchor.anchor !== true) throw new Error(`${annPath}: the first line must be the anchor`);
  const events = edgeEventsFromRows(rows.slice(1));
  const windows = cueWindows(resolveIntervals(events), manifest.t0);
  const featuresPath = join(dir, `${stem}.features.jsonl`);
  const lastT = events.reduce((m, e) => Math.max(m, e.t), manifest.t0);
  sealOpenEnded(windows, lastT, manifest.t0);

  const clicks: TakeClick[] = events
    .filter((e) => e.tag === 'click:count' || e.tag === 'click:beat')
    .map((e) => ({ t: e.t, kind: e.tag === 'click:beat' ? ('beat' as const) : ('count' as const) }))
    .sort((a, b) => a.t - b.t);
  const outcomes: Record<string, string> = {};
  for (const e of events) {
    if (!e.tag.startsWith('verdict:')) continue;
    const w = windows.filter((x) => e.t >= x.startAbs && e.t <= x.endAbs).pop();
    if (w) outcomes[w.cue] = e.tag.slice('verdict:'.length);
  }

  const micFile = (wav: boolean) => {
    const e = manifest.streams.find((s) => s.kind === 'microphone' && s.file.endsWith('.wav') === wav);
    return e && existsSync(join(dir, e.file)) ? join(dir, e.file) : null;
  };
  // A WAV converted by hand after the fact is not in the manifest: look for it by name too.
  const byName = join(dir, `${stem}.mic.wav`);
  const micWav = micFile(true) ?? (existsSync(byName) ? byName : null);
  const micDevice = manifest.streams.find((s) => s.kind === 'microphone' && typeof s.device === 'string')?.device ?? null;
  return { dir, stem, t0: manifest.t0, cues, windows, clicks, outcomes, micWav, micNative: micFile(false), micDevice, featuresPath };
}

/** The feature rows of the take (every edge the trainer recorded). */
export function readFeatureRows(path: string): FeatureRow[] {
  return existsSync(path) ? parseJsonl<FeatureRow>(readFileSync(path, 'utf8'), path) : [];
}

// ---- Pairing ------------------------------------------------------------------

export interface RealBeat {
  /** Take-relative seconds (`t - t0`), like every time below. `click` is on the engine
   *  clock (when it was scheduled to sound). */
  click: number;
  /** MIC clock: `t0` plus the time into the microphone file. */
  onset: number | null;
  /** The same instant on the FEATURE ROWS' clock (`onset` minus the slate offset): the
   *  time to compare with a row's `t - t0`. Null without a slate estimate. */
  onsetRow: number | null;
  lagMs: number | null;
  levelDb: number | null;
  chroma: number[] | null;
}

export interface AirBeat {
  click: number;
  /** MIC clock: the click plus the player's own lag on the real half of this phrase,
   *  i.e. where the strike would have sounded. */
  intended: number | null;
  /** The same on the feature rows' clock, like `RealBeat.onsetRow`. */
  intendedRow: number | null;
  /** Inherited from the real half's beat of the same index. */
  levelDb: number | null;
  chroma: number[] | null;
}

export interface Half {
  cue: string;
  start: number;
  end: number;
  outcome: string | null;
  /** Microphone onsets inside the half (an air half should have almost none). */
  onsets: number;
}

export interface PhrasePair {
  phrase: string;
  bpm: number;
  beatMs: number;
  real: (Half & { clickLagMs: number | null; matched: number }) | null;
  air: (Half & { onBeat: number }) | null;
  beats: { index: number; real: RealBeat | null; air: AirBeat | null }[];
}

export interface SlateResult {
  cue: string;
  /** Mic-clock time of the slate (median of its heard claps), take-relative seconds. */
  t: number | null;
  /** Median (clap heard − clap seen), ms, or null with fewer than
   *  {@link MIN_SLATE_CLAPS} claps both heard and seen. Seen = the minimum of
   *  `hand.pair.distance`, interpolated between rows (a parabola through the smallest
   *  row and its neighbours), so it is not quantised to a camera frame. */
  offsetMs: number | null;
  /** Median absolute deviation of the per-clap differences, ms: how far to trust it. */
  madMs: number | null;
  claps: { index: number; click: number; onset: number | null; visual: number | null }[];
}

/**
 * How the microphone's clock maps onto the feature rows' (see "Two clocks" above): the
 * offset at the first slate and its drift per second, from the last slate. `rowTime(t)`
 * in `pairTake` is `t - (offsetMs + driftMsPerS * (t - atS)) / 1000`.
 */
export interface MicToRows {
  offsetMs: number;
  /** Take-relative seconds the offset was measured at. */
  atS: number;
  /** ms per second of take; 0 with one slate. 1 ms/s would be 1000 ppm. */
  driftMsPerS: number;
}

export interface PairResult {
  version: typeof PAIRS_VERSION;
  stem: string;
  t0: number;
  micWav: string | null;
  sampleRate: number | null;
  /** The mic-to-row mapping the `*Row` fields used, or null (then they are null). */
  micToRows: MicToRows | null;
  /** Every slate cue in the routine, in order (one at the start, one at the end). */
  slates: SlateResult[];
  phrases: PhrasePair[];
  warnings: string[];
}

/** A slate needs this many claps both heard and seen to give an offset. */
export const MIN_SLATE_CLAPS = 5;
/** A slate whose per-clap differences scatter more than this (MAD, ms) is not used. */
export const MAX_SLATE_MAD_MS = 20;
/** Drift beyond this (ms per s = 300 ppm; real audio clocks are within ~100) is a bad
 *  slate, not a clock: fall back to the offset alone. */
export const MAX_DRIFT_MS_PER_S = 0.3;

/** Device names that are a headset's microphone, not the computer's. */
const HEADSET_MIC = /airpods|headset|hands-?free|bluetooth|buds|\bbeats\b/i;

/** The feature id whose minimum marks a visible clap. */
const CLAP_FEATURE = 'hand.pair.distance';
const HAND_VECTOR_EDGE = 'handVec.vector';

/** The strategies `pairTake` uses, replaceable without touching it. */
export interface PairOptions {
  /** The onset detector (seconds from the start of `pcm`). Default {@link detectOnsets}. */
  detect?: (pcm: Float32Array, sampleRate: number, options?: OnsetOptions) => number[];
  /** Options passed to it. */
  onset?: OnsetOptions;
}

/**
 * Pair a read take (pure: every input is passed in). `audio` is the microphone, null
 * when the take has none (then only the air halves' click grid survives, and it says so).
 */
export function pairTake(take: Take, audio: Wav | null, features: readonly FeatureRow[], options: PairOptions = {}): PairResult {
  const { detect = detectOnsets, onset } = options;
  const warnings: string[] = [];
  const rel = (tAbs: number) => tAbs - take.t0;
  const onsetsAbs = audio ? detect(audio.pcm, audio.sampleRate, onset).map((s) => take.t0 + s) : [];
  // A Bluetooth headset's own microphone runs the phone-call profile: 8 to 16 kHz, heavy
  // processing, and extra latency. The routine wants the computer's built-in microphone.
  if (take.micDevice && HEADSET_MIC.test(take.micDevice)) {
    warnings.push(`The microphone was "${take.micDevice}", a headset's: its call-quality profile blurs onsets. Record with the computer's built-in microphone.`);
  }
  if (audio && audio.sampleRate < 44100) {
    warnings.push(`The microphone WAV is ${audio.sampleRate} Hz: onsets are tuned at 44.1/48 kHz (a strum's attack lives in its upper partials), so some strums may go unheard.`);
  }
  if (!audio) {
    warnings.push(
      take.micNative
        ? `The take's microphone is only in ${basename(take.micNative)} (the browser could not decode it to WAV). Convert it, e.g. \`ffmpeg -i ${basename(take.micNative)} -ac 1 ${take.stem}.mic.wav\` in the take folder, then run this again.`
        : 'The take has no microphone file: real halves have no labels (was the microphone allowed?).',
    );
  }

  const windowOf = (cueId: string) => take.windows.find((w) => w.cue === cueId) ?? null;
  const inWindow = (tAbs: number, w: CueWindow) => tAbs >= w.startAbs && tAbs <= w.endAbs;
  const beatClicks = (w: CueWindow) => take.clicks.filter((c) => c.kind === 'beat' && inWindow(c.t, w)).map((c) => c.t);
  const beatMsOf = (cue: Cue) => clickPlan(cue)?.beatMs ?? NaN;
  const atAudio = (tAbs: number) => tAbs - take.t0;
  const half = (cue: Cue, w: CueWindow): Half => ({
    cue: cue.id,
    start: rel(w.startAbs),
    end: rel(w.endAbs),
    outcome: take.outcomes[cue.id] ?? null,
    onsets: onsetsAbs.filter((t) => inWindow(t, w)).length,
  });

  // The slates: claps against clicks, and, where the camera saw both hands, the visible
  // contact (the minimum inter-hand distance near each clap). Two slates (the routine
  // opens and closes with one) give the drift of the microphone's clock as well.
  const handRows = features.filter((r) => r.key === HAND_VECTOR_EDGE);
  const slates: SlateResult[] = [];
  for (const slateCue of take.cues.filter((c) => c.tags.includes('slate') && windowOf(c.id))) {
    const w = windowOf(slateCue.id)!;
    const beatMs = beatMsOf(slateCue);
    const clicks = beatClicks(w);
    const matched = matchOnGrid(clicks, onsetsAbs.filter((t) => inWindow(t, w)), beatMs / 1000);
    const visualNear = (tAbs: number): number | null => {
      const near = handRows
        .filter((r) => inWindow(r.t, w) && Math.abs(r.t - tAbs) <= beatMs / 2000)
        .map((r) => ({ t: r.t, d: (r.value as Record<string, unknown> | null)?.[CLAP_FEATURE] }))
        .filter((x): x is { t: number; d: number } => typeof x.d === 'number' && Number.isFinite(x.d))
        .sort((a, b) => a.t - b.t);
      if (near.length === 0) return null;
      let k = 0;
      for (let i = 1; i < near.length; i++) if (near[i].d < near[k].d) k = i;
      // The contact falls between frames; the smallest row is up to a frame off it. A
      // parabola through it and its two neighbours puts the minimum between them.
      const [a, b, c] = [near[k - 1], near[k], near[k + 1]];
      if (!a || !c) return b.t;
      const h = (c.t - a.t) / 2;
      const curv = a.d - 2 * b.d + c.d;
      if (!(curv > 0) || Math.abs(b.t - a.t - h) > h * 0.25) return b.t; // flat, or uneven rows
      return b.t + Math.max(-h, Math.min(h, (h * (a.d - c.d)) / (2 * curv)));
    };
    const claps = clicks.map((c, i) => {
      const onset = matched[i];
      const visual = onset === null ? null : visualNear(onset);
      return { index: i, click: rel(c), onset: onset === null ? null : rel(onset), visual: visual === null ? null : rel(visual) };
    });
    const diffs = claps.filter((c) => c.onset !== null && c.visual !== null).map((c) => (c.onset! - c.visual!) * 1000);
    const heard = claps.filter((c) => c.onset !== null).map((c) => c.onset!);
    const mid = diffs.length ? median(diffs) : NaN;
    const madMs = diffs.length ? Math.round(median(diffs.map((d) => Math.abs(d - mid))) * 10) / 10 : null;
    let offsetMs: number | null = null;
    if (diffs.length < MIN_SLATE_CLAPS) {
      warnings.push(`Slate "${slateCue.id}": ${diffs.length} clap(s) both heard and seen, so no clock offset from it (needs ${MIN_SLATE_CLAPS}; were both hands in view?).`);
    } else if (madMs! > MAX_SLATE_MAD_MS) {
      warnings.push(`Slate "${slateCue.id}": its claps disagree by ${madMs} ms (MAD), so it is not used.`);
    } else {
      offsetMs = Math.round(mid * 10) / 10;
    }
    slates.push({ cue: slateCue.id, t: heard.length ? median(heard) : null, offsetMs, madMs, claps });
  }
  const measured = slates.filter((x): x is SlateResult & { t: number; offsetMs: number } => x.t !== null && x.offsetMs !== null);
  let micToRows: MicToRows | null = null;
  if (measured.length >= 1) {
    const a = measured[0];
    const b = measured[measured.length - 1];
    let driftMsPerS = b !== a && b.t > a.t ? Math.round(((b.offsetMs - a.offsetMs) / (b.t - a.t)) * 1000) / 1000 : 0;
    if (Math.abs(driftMsPerS) > MAX_DRIFT_MS_PER_S) {
      warnings.push(`The slates disagree by ${Math.round(b.offsetMs - a.offsetMs)} ms (${driftMsPerS} ms/s, more than any audio clock drifts): using the first slate's offset alone.`);
      driftMsPerS = 0;
    }
    micToRows = { offsetMs: a.offsetMs, atS: a.t, driftMsPerS };
  } else if (audio) {
    warnings.push('No slate offset: the *Row fields are null, and mic-clock times carry the microphone start offset (tens of ms).');
  }
  /** A take-relative mic-clock time on the feature rows' clock, or null. */
  const toRow = (tRel: number | null): number | null =>
    tRel === null || !micToRows ? null : Math.round((tRel - (micToRows.offsetMs + micToRows.driftMsPerS * (tRel - micToRows.atS)) / 1000) * 1e6) / 1e6;

  // The phrases, by their pairing.
  const phraseIds: string[] = [];
  for (const c of take.cues) if (c.pairing && !phraseIds.includes(c.pairing.phrase)) phraseIds.push(c.pairing.phrase);
  const phrases: PhrasePair[] = [];
  for (const phrase of phraseIds) {
    const realCue = take.cues.find((c) => c.pairing?.phrase === phrase && c.pairing.surface === 'real');
    const airCue = take.cues.find((c) => c.pairing?.phrase === phrase && c.pairing.surface === 'air');
    const rw = realCue ? windowOf(realCue.id) : null;
    const aw = airCue ? windowOf(airCue.id) : null;
    const plan = clickPlan((realCue ?? airCue)!);
    const beatMs = plan?.beatMs ?? NaN;
    const bpm = Math.round(60000 / beatMs);
    if (!rw) warnings.push(`Phrase "${phrase}": the real half was not recorded; the air half has no lag to inherit.`);
    if (!aw) warnings.push(`Phrase "${phrase}": the air half was not recorded.`);

    let real: PhrasePair['real'] = null;
    const realBeats: RealBeat[] = [];
    let lagMs: number | null = null;
    if (realCue && rw) {
      const clicks = beatClicks(rw);
      const matched = matchOnGrid(clicks, onsetsAbs.filter((t) => inWindow(t, rw)), beatMs / 1000);
      clicks.forEach((c, i) => {
        const on = matched[i];
        realBeats.push({
          click: rel(c),
          onset: on === null ? null : rel(on),
          onsetRow: toRow(on === null ? null : rel(on)),
          lagMs: on === null ? null : Math.round((on - c) * 10000) / 10,
          levelDb: on === null || !audio ? null : Math.round(levelDb(audio.pcm, audio.sampleRate, atAudio(on)) * 10) / 10,
          chroma: on === null || !audio ? null : chroma(audio.pcm, audio.sampleRate, atAudio(on)),
        });
      });
      const lags = realBeats.map((b) => b.lagMs).filter((x): x is number => x !== null);
      lagMs = lags.length > 0 ? Math.round(median(lags) * 10) / 10 : null;
      const matchedCount = lags.length;
      if (audio && matchedCount < clicks.length) {
        // Name the beats: in the soft-and-hard phrase, unheard beats in fours are the
        // soft ones, which is a microphone-level problem and not a timing one.
        const unheard = realBeats.map((b, i) => (b.onset === null ? i + 1 : 0)).filter((i) => i > 0);
        warnings.push(`Phrase "${phrase}": ${matchedCount}/${clicks.length} real beats heard (unheard: ${unheard.join(', ')}); check the microphone level, or that the phrase was played on the clicks.`);
      }
      real = { ...half(realCue, rw), clickLagMs: lagMs, matched: matchedCount };
    }

    let air: PhrasePair['air'] = null;
    const airBeats: AirBeat[] = [];
    if (airCue && aw) {
      const clicks = beatClicks(aw);
      clicks.forEach((c, i) => {
        const r = realBeats[i];
        const intended = lagMs === null ? null : Math.round((rel(c) + lagMs / 1000) * 1e6) / 1e6;
        airBeats.push({
          click: rel(c),
          intended,
          intendedRow: toRow(intended),
          levelDb: r?.levelDb ?? null,
          chroma: r?.chroma ?? null,
        });
      });
      // The microphone should hear nothing in the air. Sound ON the beats means the
      // click leaked into the microphone (a speaker, not headphones) or the player
      // touched the surface; either way the real labels near it are suspect too.
      const onBeat = matchToClicks(clicks, onsetsAbs.filter((t) => inWindow(t, aw)), beatMs / 4000).filter((x) => x !== null).length;
      if (clicks.length > 0 && onBeat >= clicks.length / 2) {
        warnings.push(`Phrase "${phrase}": the microphone heard ${onBeat}/${clicks.length} air beats. Click bleed (use headphones) or a touched surface.`);
      }
      air = { ...half(airCue, aw), onBeat };
    }

    const n = Math.max(realBeats.length, airBeats.length);
    phrases.push({
      phrase,
      bpm,
      beatMs,
      real,
      air,
      beats: Array.from({ length: n }, (_, index) => ({ index, real: realBeats[index] ?? null, air: airBeats[index] ?? null })),
    });
  }
  if (phrases.length === 0) warnings.push('No paired cues in this routine: nothing to pair.');

  return {
    version: PAIRS_VERSION,
    stem: take.stem,
    t0: take.t0,
    micWav: take.micWav ? basename(take.micWav) : null,
    sampleRate: audio?.sampleRate ?? null,
    micToRows,
    slates,
    phrases,
    warnings,
  };
}

// ---- Files -----------------------------------------------------------------------

/** `<root>/takes/cue` and `<root>/datasets/cue`: where takes and their pairs live. */
export function cueDirs(env: NodeJS.ProcessEnv = process.env): { takes: string; datasets: string } {
  const root = dataRoot(env);
  return { takes: join(root, 'takes', 'cue'), datasets: join(root, 'datasets', 'cue') };
}

/**
 * A take folder from what the player has: the unzipped folder itself, or the `.zip` a
 * `downloads` take lands as, which is extracted under `takesRoot/<zip name>/`.
 */
export function resolveTakeInput(input: string, takesRoot: string): string {
  if (!existsSync(input)) throw new Error(`${input}: no such file or folder`);
  if (statSync(input).isDirectory()) return input;
  if (!input.toLowerCase().endsWith('.zip')) throw new Error(`${input}: expected a take folder or its .zip`);
  const dest = join(takesRoot, basename(input).replace(/\.zip$/i, ''));
  const files = unzipSync(new Uint8Array(readFileSync(input)));
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    // Directories, and the resource forks a Finder re-zip adds (`__MACOSX/`, `._name`),
    // which would otherwise read as a second take.
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || basename(name).startsWith('._')) continue;
    // Flatten: a take zip is one folder of files; never write outside `dest`.
    writeFileSync(join(dest, basename(name)), bytes);
  }
  return dest;
}

/** Write the pairs and the per-half feature slices. Returns the files written. */
export function writePairs(result: PairResult, take: Take, features: readonly FeatureRow[], outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  const put = (name: string, text: string) => {
    writeFileSync(join(outDir, name), text);
    written.push(name);
  };
  put('pairs.json', JSON.stringify(result, null, 2) + '\n');
  const slice = (name: string, cueId: string) => {
    const w = take.windows.find((x) => x.cue === cueId);
    if (!w) return;
    const rows = features.filter((r) => r.t >= w.startAbs && r.t <= w.endAbs);
    put(name, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  };
  for (const sl of result.slates) slice(`${sl.cue}.features.jsonl`, sl.cue);
  for (const p of result.phrases) {
    if (p.real) slice(`${p.phrase}.real.features.jsonl`, p.real.cue);
    if (p.air) slice(`${p.phrase}.air.features.jsonl`, p.air.cue);
  }
  // The microphone beside its labels, so a listener can check them.
  if (take.micWav) {
    copyFileSync(take.micWav, join(outDir, 'mic.wav'));
    written.push('mic.wav');
  }
  return written;
}

/** One line per phrase: what a person reads after running the CLI. */
export function summarize(result: PairResult): string[] {
  const lines = [`take ${result.stem}`];
  const m = result.micToRows;
  lines.push(`  mic to feature rows: ${m ? `${m.offsetMs} ms, drift ${m.driftMsPerS} ms/s (the *Row fields apply it)` : 'not estimated (no *Row fields)'}`);
  for (const p of result.phrases) {
    const r = p.real ? `real ${p.real.matched}/${p.beats.filter((b) => b.real).length} beats heard, lag ${p.real.clickLagMs ?? '?'} ms` : 'no real half';
    const a = p.air ? `air ${p.beats.filter((b) => b.air).length} beats, ${p.air.onBeat} heard` : 'no air half';
    lines.push(`  ${p.phrase} @ ${p.bpm} bpm: ${r}; ${a}`);
  }
  for (const w of result.warnings) lines.push(`  warning: ${w}`);
  return lines;
}

/**
 * Refuse an output directory inside a git work tree. The pairs carry the player's
 * microphone (`mic.wav`) and hand motion, and thoremin is a public repository: an
 * `--out .` from the repo root must fail here, not at code review.
 */
export function refuseInsideGitWorkTree(dir: string): void {
  let d = resolve(dir);
  for (;;) {
    if (existsSync(join(d, '.git'))) {
      throw new Error(`${dir} is inside the git work tree at ${d}. A take's pairs hold the player's microphone and motion; write them under the app-data dir (the default) or anywhere outside a repository.`);
    }
    const up = dirname(d);
    if (up === d) return;
    d = up;
  }
}

/** The whole job: resolve the input, read, pair, write. */
export function runPairTake(
  input: string,
  opts: { env?: NodeJS.ProcessEnv; outDir?: string } & PairOptions = {},
): { outDir: string; result: PairResult; written: string[] } {
  const dirs = cueDirs(opts.env);
  // Both the extracted take and the pairs: a THOREMIN_DATA_DIR pointed into a checkout
  // is the same leak as an --out into one.
  refuseInsideGitWorkTree(dirs.takes);
  refuseInsideGitWorkTree(opts.outDir ?? dirs.datasets);
  const takeDir = resolveTakeInput(input, dirs.takes);
  const take = readTake(takeDir);
  const audio = take.micWav ? parseWav(new Uint8Array(readFileSync(take.micWav))) : null;
  const features = readFeatureRows(take.featuresPath);
  const result = pairTake(take, audio, features, { detect: opts.detect, onset: opts.onset });
  const outDir = opts.outDir ?? join(dirs.datasets, take.stem);
  const written = writePairs(result, take, features, outDir);
  return { outDir, result, written };
}
