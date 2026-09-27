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
 * - the feature rows of each half are sliced out beside the pairs, rows untouched, so
 *   anything computed later joins back on `t`.
 *
 * ## Two clocks, one of which is estimated, never silently applied
 *
 * The microphone file starts at the recorder's `t0`, give or take the time the browser
 * took to start its recorder and the input latency. The clap at the start of the routine
 * is a slate: its sound and the visible contact of the two hands (the minimum of
 * `hand.pair.distance`) are the same instant, so their median difference estimates the
 * microphone's offset from the camera. It is REPORTED (`avOffsetMs`) and not applied,
 * because every label the real half produces is on the microphone's clock and every
 * label of the air half is on the click's; a consumer comparing the two to the camera
 * decides whether to shift, and says so.
 *
 * ## Why not the latency probe's onset detector
 *
 * `src/latency/onsets.ts` detects a slap with hysteresis: the envelope must fall back
 * below half its threshold before another strike counts. A strummed chord rings through
 * the next click, so that detector sees the first strum and nothing after. This one
 * detects RISES (energy against its own recent minimum), which a new strum over a
 * ringing one still is, and a tap on a silent table trivially is.
 *
 * Nothing written here is ever committed: a take is the player's body and room, and it
 * goes under the app-data directory (`~/.local/share/thoremin/`), never the repository.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
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
  /** ...and `rise` × its own minimum over the previous `lookbackMs`. */
  rise?: number;
  lookbackMs?: number;
  /** No second onset sooner than this after one. */
  refractoryMs?: number;
}

export const ONSET_DEFAULTS: Required<OnsetOptions> = {
  hopMs: 1,
  windowMs: 5,
  noiseFactor: 6,
  floorPercentile: 0.05,
  // 6 dB over the last 30 ms: a tap on a silent table rises by tens of dB, and a new
  // strum over a ringing chord still roughly doubles the level.
  rise: 2,
  lookbackMs: 30,
  refractoryMs: 80,
};

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Onset times (seconds from the buffer start): moments the RMS envelope rises above the
 * noise floor AND above `rise` times its own MAXIMUM over the previous `lookbackMs`.
 * Against the recent maximum, not the minimum, because a chord's partials beat against
 * each other: its envelope dips and recovers every few tens of ms, and each recovery is
 * a rise against the dip but never against the last peak. A new strum or tap clears the
 * last peak. Each onset is placed at the attack's first sample: the first to exceed both
 * a quarter of the attack's peak and 1.5 times the loudest sample before it.
 */
export function detectOnsets(pcm: Float32Array, sampleRate: number, options: OnsetOptions = {}): number[] {
  const o = { ...ONSET_DEFAULTS, ...options };
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
    streams: { file: string; kind: string }[];
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

  const micEntry = manifest.streams.find((s) => s.kind === 'microphone' && s.file.endsWith('.wav'));
  const micWav = micEntry && existsSync(join(dir, micEntry.file)) ? join(dir, micEntry.file) : null;
  return { dir, stem, t0: manifest.t0, cues, windows, clicks, outcomes, micWav, featuresPath };
}

/** The feature rows of the take (every edge the trainer recorded). */
export function readFeatureRows(path: string): FeatureRow[] {
  return existsSync(path) ? parseJsonl<FeatureRow>(readFileSync(path, 'utf8'), path) : [];
}

// ---- Pairing ------------------------------------------------------------------

export interface RealBeat {
  /** Take-relative seconds (`t - t0`), like every time below. */
  click: number;
  onset: number | null;
  lagMs: number | null;
  levelDb: number | null;
  chroma: number[] | null;
}

export interface AirBeat {
  click: number;
  /** The click plus the player's own lag on the real half of this phrase. */
  intended: number | null;
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
  claps: { index: number; click: number; onset: number | null; visual: number | null }[];
}

export interface PairResult {
  version: typeof PAIRS_VERSION;
  stem: string;
  t0: number;
  micWav: string | null;
  sampleRate: number | null;
  /** Median (clap sound − visible clap), ms; positive = the microphone runs late. Not applied. */
  avOffsetMs: number | null;
  slate: SlateResult | null;
  phrases: PhrasePair[];
  warnings: string[];
}

/** The feature id whose minimum marks a visible clap. */
const CLAP_FEATURE = 'hand.pair.distance';
const HAND_VECTOR_EDGE = 'handVec.vector';

/**
 * Pair a read take (pure: every input is passed in). `audio` is the microphone, null
 * when the take has none (then only the air halves' click grid survives, and it says so).
 */
export function pairTake(take: Take, audio: Wav | null, features: readonly FeatureRow[]): PairResult {
  const warnings: string[] = [];
  const rel = (tAbs: number) => tAbs - take.t0;
  const onsetsAbs = audio ? detectOnsets(audio.pcm, audio.sampleRate).map((s) => take.t0 + s) : [];
  if (!audio) warnings.push('The take has no microphone WAV: real halves have no labels (was the microphone allowed?).');

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

  // The slate: claps against clicks, and, where the camera saw both hands, the visible
  // contact (the minimum inter-hand distance near each clap).
  let slate: SlateResult | null = null;
  let avOffsetMs: number | null = null;
  const slateCue = take.cues.find((c) => c.tags.includes('slate') && windowOf(c.id));
  if (slateCue) {
    const w = windowOf(slateCue.id)!;
    const beatMs = beatMsOf(slateCue);
    const clicks = beatClicks(w);
    const matched = matchToClicks(clicks, onsetsAbs.filter((t) => inWindow(t, w)), beatMs / 2000);
    const handRows = features.filter((r) => r.key === HAND_VECTOR_EDGE && inWindow(r.t, w));
    const visualNear = (tAbs: number): number | null => {
      let best: { t: number; d: number } | null = null;
      for (const r of handRows) {
        if (Math.abs(r.t - tAbs) > beatMs / 2000) continue;
        const d = (r.value as Record<string, unknown> | null)?.[CLAP_FEATURE];
        if (typeof d === 'number' && Number.isFinite(d) && (!best || d < best.d)) best = { t: r.t, d };
      }
      return best ? best.t : null;
    };
    slate = {
      cue: slateCue.id,
      claps: clicks.map((c, i) => {
        const onset = matched[i];
        const visual = onset === null ? null : visualNear(onset);
        return { index: i, click: rel(c), onset: onset === null ? null : rel(onset), visual: visual === null ? null : rel(visual) };
      }),
    };
    const diffs = slate.claps.filter((c) => c.onset !== null && c.visual !== null).map((c) => (c.onset! - c.visual!) * 1000);
    if (diffs.length >= 2) avOffsetMs = Math.round(median(diffs) * 10) / 10;
    else warnings.push(`The slate gave ${diffs.length} clap(s) both heard and seen; the microphone-to-camera offset is not estimated (needs 2).`);
  }

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
      const matched = matchToClicks(clicks, onsetsAbs.filter((t) => inWindow(t, rw)), beatMs / 2000);
      clicks.forEach((c, i) => {
        const on = matched[i];
        realBeats.push({
          click: rel(c),
          onset: on === null ? null : rel(on),
          lagMs: on === null ? null : Math.round((on - c) * 10000) / 10,
          levelDb: on === null || !audio ? null : Math.round(levelDb(audio.pcm, audio.sampleRate, atAudio(on)) * 10) / 10,
          chroma: on === null || !audio ? null : chroma(audio.pcm, audio.sampleRate, atAudio(on)),
        });
      });
      const lags = realBeats.map((b) => b.lagMs).filter((x): x is number => x !== null);
      lagMs = lags.length > 0 ? Math.round(median(lags) * 10) / 10 : null;
      const matchedCount = lags.length;
      if (audio && matchedCount < clicks.length / 2) {
        warnings.push(`Phrase "${phrase}": only ${matchedCount}/${clicks.length} real beats were heard; check the microphone level, or that the phrase was played on the clicks.`);
      }
      real = { ...half(realCue, rw), clickLagMs: lagMs, matched: matchedCount };
    }

    let air: PhrasePair['air'] = null;
    const airBeats: AirBeat[] = [];
    if (airCue && aw) {
      const clicks = beatClicks(aw);
      clicks.forEach((c, i) => {
        const r = realBeats[i];
        airBeats.push({
          click: rel(c),
          intended: lagMs === null ? null : Math.round((rel(c) + lagMs / 1000) * 1e6) / 1e6,
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
    avOffsetMs,
    slate,
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
    if (name.endsWith('/')) continue;
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
  if (result.slate) slice('slate.features.jsonl', result.slate.cue);
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
  lines.push(`  mic-to-camera offset: ${result.avOffsetMs === null ? 'not estimated' : `${result.avOffsetMs} ms (not applied)`}`);
  for (const p of result.phrases) {
    const r = p.real ? `real ${p.real.matched}/${p.beats.filter((b) => b.real).length} beats heard, lag ${p.real.clickLagMs ?? '?'} ms` : 'no real half';
    const a = p.air ? `air ${p.beats.filter((b) => b.air).length} beats, ${p.air.onBeat} heard` : 'no air half';
    lines.push(`  ${p.phrase} @ ${p.bpm} bpm: ${r}; ${a}`);
  }
  for (const w of result.warnings) lines.push(`  warning: ${w}`);
  return lines;
}

/** The whole job: resolve the input, read, pair, write. */
export function runPairTake(input: string, opts: { env?: NodeJS.ProcessEnv; outDir?: string } = {}): { outDir: string; result: PairResult; written: string[] } {
  const dirs = cueDirs(opts.env);
  const takeDir = resolveTakeInput(input, dirs.takes);
  const take = readTake(takeDir);
  const audio = take.micWav ? parseWav(new Uint8Array(readFileSync(take.micWav))) : null;
  const features = readFeatureRows(take.featuresPath);
  const result = pairTake(take, audio, features);
  const outDir = opts.outDir ?? join(dirs.datasets, take.stem);
  const written = writePairs(result, take, features, outDir);
  return { outDir, result, written };
}
