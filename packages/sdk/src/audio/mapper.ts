/**
 * The sound mapper's audio-thread pipeline: a struck sound in, the sample mapped to its class
 * out, with no main-thread round trip (`docs/design/audio-input.md`, "two paths").
 *
 * Per render quantum: the input goes into a history ring and through the onset detector; each
 * onset waits until `window` samples from just before it have arrived (`preRoll`: the detector
 * places an onset at the first loud sample, and the few before it carry the attack's start),
 * then its attack features are classified and, when its class is mapped, the class's sample
 * starts AT THE SAMPLE where the decision became possible, inside this same output quantum.
 * So the algorithmic latency is `window - preRoll` samples plus at most a detector hop, and
 * does not depend on the quantum size; what the player hears adds only the device's input
 * and output stages (`docs/research/audio-trigger-latency.md`).
 *
 * **Sound early, decide late** (`docs/research/live-audio-to-audio.md` §6). The first few
 * milliseconds of an attack separate surfaces less well than the first ten or twenty; every
 * millisecond of window is latency the player hears. With `refineMs` set, the sample sounds on
 * the short window's decision and the class is decided again on the long window; when it
 * changes, the first sample fades out over `crossfadeMs` and the corrected one fades in, started
 * as far into itself as the first had played, so the hit stays where it was struck. A wrong
 * class is then heard for `refineMs - windowMs` at most, and is never left ringing.
 *
 * The hit's strength sets the sample's gain (`velocity`: 0 = every hit the same, 1 = fully
 * proportional, relative to `refPeak`, the taught taps' typical peak). With capture on, the
 * raw audio around each onset is sent too (`snippet` events), which is how examples are taught
 * from the very detector that will hear them.
 *
 * Everything is preallocated; `process` allocates only the event objects it returns (a few per
 * second) and a captured snippet. The returned array is reused: read it before the next call.
 */
import type { AnalyserMessage, AudioAnalyser, AudioEvent, ClassEvent } from './types';
import { createOnsetDetector, type OnsetOptions } from './onset';
import { createAttackFeatures, type AttackFeatures } from './features';
import { createSoundClassifier, type SoundClassifier, type SoundModel } from './classifier';
import { createSampler, type Sampler } from './sampler';
import { SNIPPET } from './examples';

export interface SoundMapperOptions {
  sampleRate: number;
  /** The fast analysis window, ms (every ms of it is latency). */
  windowMs?: number;
  /** The refining window, ms (0 = decide once). */
  refineMs?: number;
  /** The crossfade when a refinement swaps the sample, ms. */
  crossfadeMs?: number;
  /** Samples before the onset included in the window. */
  preRoll?: number;
  onset?: Partial<Omit<OnsetOptions, 'sampleRate'>>;
  maxVoices?: number;
  /** A level event every this many ms (0 = none). */
  levelEveryMs?: number;
  /** How much the hit's strength sets the gain, 0..1. */
  velocity?: number;
  /** The peak a typical taught tap reaches (gain 1 at full velocity). */
  refPeak?: number;
  /** Output gain of every sample. */
  gain?: number;
  /**
   * Subtract the spectrum of the window before the onset (a previous tap's tail). Off by
   * default: it helps when the tail is ANOTHER surface's, and it erases the surface's own modes
   * when the same surface is struck twice in a row, which on real hits is the common case
   * (`docs/research/audio-trigger-latency.md` §4).
   */
  subtractTail?: boolean;
  /** How the attack's spectral shape is summarised (`./features.ts`). */
  shape?: 'bands' | 'mfcc';
}

export const SOUND_MAPPER_DEFAULTS = {
  windowMs: 4,
  refineMs: 12,
  crossfadeMs: 3,
  preRoll: 32,
  maxVoices: 16,
  levelEveryMs: 50,
  velocity: 0.6,
  refPeak: 0.25,
  gain: 0.9,
  subtractTail: false,
  shape: 'mfcc' as 'bands' | 'mfcc',
};

/** The messages a sound mapper understands (from the host, through the worklet's port). */
export type SoundMapperMessage =
  | { type: 'model'; fast: SoundModel | null; final?: SoundModel | null; mapping?: Record<string, string>; refPeak?: number }
  | { type: 'mapping'; mapping: Record<string, string> }
  | { type: 'sample'; id: string; data: Float32Array | null }
  | { type: 'params'; velocity?: number; gain?: number; refPeak?: number }
  | { type: 'capture'; on: boolean }
  | { type: 'stop' };

export interface SoundMapper extends AudioAnalyser {
  /** The fast and refining windows, samples (refine 0 = off). */
  readonly window: number;
  readonly refineWindow: number;
  readonly preRoll: number;
  readonly features: AttackFeatures;
  readonly sampler: Sampler;
  configure(message: AnalyserMessage | SoundMapperMessage): void;
}

interface Pending {
  onset: number;
  /** When the fast decision is possible, and the final one (-1 = none). */
  fastAt: number;
  finalAt: number;
  /** The fast decision's label, voice handle, the frame it started and its gain (once made). */
  label: string | null;
  voice: number;
  started: number;
  gain: number;
  decided: boolean;
  peak: number;
}

const POOL = 32;

export function createSoundMapper(options: SoundMapperOptions): SoundMapper {
  const o = { ...SOUND_MAPPER_DEFAULTS, ...options };
  const sr = o.sampleRate;
  const ms = (x: number) => Math.round((x / 1000) * sr);
  const window = Math.max(16, ms(o.windowMs));
  const refineWindow = o.refineMs > o.windowMs ? Math.max(16, ms(o.refineMs)) : 0;
  const longest = Math.max(window, refineWindow);
  const preRoll = Math.max(0, Math.min(window - 1, Math.round(o.preRoll)));
  const crossfade = Math.max(1, ms(o.crossfadeMs));
  const detector = createOnsetDetector({ sampleRate: sr, ...o.onset });
  const features = createAttackFeatures({ sampleRate: sr, window, shape: o.shape });
  const refineFeatures = refineWindow ? createAttackFeatures({ sampleRate: sr, window: refineWindow, shape: o.shape }) : null;
  const sampler = createSampler({ maxVoices: o.maxVoices });
  const snipPre = ms(SNIPPET.preMs);
  const snipPost = ms(SNIPPET.postMs);
  // History: enough for the longest window and its background, a snippet, and a few quanta.
  const ringSize = 2 ** Math.ceil(Math.log2(Math.max(2 * longest + preRoll, snipPre + snipPost) + 4096));
  const ring = new Float32Array(ringSize);
  const mask = ringSize - 1;
  let written = 0;
  let started = false;
  const linear = new Float32Array(2 * longest);
  const vec = new Float64Array(features.size);
  const pool: Pending[] = Array.from({ length: POOL }, () => ({ onset: 0, fastAt: 0, finalAt: -1, label: null, voice: -1, started: 0, gain: 0, decided: false, peak: 0 }));
  let live = 0; // pool[0, live) are pending
  const snippetsDue: number[] = [];
  const events: AudioEvent[] = [];
  let fast: SoundClassifier | null = null;
  let final: SoundClassifier | null = null;
  let mapping: Record<string, string> = {};
  let capture = false;
  let velocity = o.velocity;
  let gain = o.gain;
  let refPeak = o.refPeak;
  const levelEvery = o.levelEveryMs > 0 ? ms(o.levelEveryMs) : 0;
  let levelSum = 0;
  let levelPeak = 0;
  let levelN = 0;
  let blockStart = 0;

  const onOnset = (d: { frame: number; detectedFrame: number; strength: number }) => {
    events.push({ kind: 'onset', frame: d.frame, detectedFrame: d.detectedFrame, strength: d.strength });
    if (capture) snippetsDue.push(d.frame);
    if (live === POOL) return; // 32 onsets inside one window: not a tap
    const p = pool[live++];
    p.onset = d.frame;
    p.fastAt = Math.max(d.detectedFrame, d.frame - preRoll + window);
    p.finalAt = refineWindow ? Math.max(d.detectedFrame, d.frame - preRoll + refineWindow) : -1;
    p.label = null;
    p.voice = -1;
    p.decided = false;
    p.peak = 0;
  };

  /** Fill `linear` with [background | window] for an onset and window length; returns the window's peak. */
  const load = (onset: number, w: number): number => {
    const from = onset - preRoll - w;
    let peak = 0;
    for (let i = 0; i < 2 * w; i++) {
      const x = ring[(from + i) & mask];
      linear[i] = x;
      if (i >= w) peak = Math.max(peak, x < 0 ? -x : x);
    }
    return peak;
  };

  // A decision possible at the block's end sounds at the next block's first sample (the sampler
  // carries a delay past its block), never a sample early.
  const offsetOf = (frame: number) => Math.max(0, frame - blockStart);

  const classEvent = (p: Pending, at: number, decision: ReturnType<SoundClassifier['classify']> | null, sample: string | null, stage: 'fast' | 'final', revised: boolean): ClassEvent => ({
    kind: 'class',
    frame: p.onset,
    decidedFrame: at,
    label: decision?.label ?? null,
    confidence: decision?.confidence ?? 0,
    distance: decision?.distance ?? Infinity,
    peak: p.peak,
    sample,
    stage,
    revised,
  });

  const decideFast = (p: Pending) => {
    p.peak = load(p.onset, window);
    features.compute(linear, window, vec, o.subtractTail ? 0 : undefined);
    const decision = fast ? fast.classify(vec) : null;
    p.label = decision?.label ?? null;
    p.decided = true;
    const sampleId = p.label !== null ? (mapping[p.label] ?? null) : null;
    let played: string | null = null;
    if (sampleId !== null) {
      const strength = Math.min(2, p.peak / Math.max(1e-4, refPeak));
      p.gain = gain * (1 - velocity + velocity * Math.sqrt(strength));
      p.started = p.fastAt;
      p.voice = sampler.trigger(sampleId, p.gain, offsetOf(p.fastAt));
      if (p.voice >= 0) played = sampleId;
    }
    events.push(classEvent(p, p.fastAt, decision, played, 'fast', false));
  };

  const decideFinal = (p: Pending) => {
    if (!refineFeatures || !final) return;
    load(p.onset, refineWindow);
    refineFeatures.compute(linear, refineWindow, vec, o.subtractTail ? 0 : undefined);
    const decision = final.classify(vec);
    // A refinement that rejects keeps the fast class: a correction must name something better.
    const label = decision.label ?? p.label;
    const revised = label !== p.label;
    let played = p.label !== null ? (mapping[p.label] ?? null) : null;
    if (revised && label !== null) {
      const sampleId = mapping[label] ?? null;
      const at = offsetOf(p.finalAt);
      if (p.voice >= 0) sampler.release(p.voice, at, crossfade);
      played = null;
      if (sampleId !== null) {
        const g = p.voice >= 0 ? p.gain : gain * (1 - velocity + velocity * Math.sqrt(Math.min(2, p.peak / Math.max(1e-4, refPeak))));
        // Started as far in as the first had played, so the hit stays where it was struck.
        const startAt = p.voice >= 0 ? p.finalAt - p.started : 0;
        if (sampler.trigger(sampleId, g, at, { startAt, fadeIn: crossfade }) >= 0) played = sampleId;
      }
    }
    events.push(classEvent(p, p.finalAt, { ...decision, label }, played, 'final', revised));
  };

  const sendSnippets = () => {
    for (let k = 0; k < snippetsDue.length; ) {
      const onset = snippetsDue[k];
      if (onset + snipPost > written) {
        k++;
        continue;
      }
      const pcm = new Float32Array(snipPre + snipPost);
      for (let i = 0; i < pcm.length; i++) pcm[i] = ring[(onset - snipPre + i) & mask];
      events.push({ kind: 'snippet', frame: onset, onset: snipPre, sampleRate: sr, pcm });
      snippetsDue.splice(k, 1);
    }
  };

  return {
    window,
    refineWindow,
    preRoll,
    features,
    sampler,
    process(input, output, frame) {
      events.length = 0;
      if (!started || frame !== written) {
        // First block, or a gap (the context was suspended): start the history afresh.
        started = true;
        live = 0;
        snippetsDue.length = 0;
      }
      blockStart = frame;
      for (let i = 0; i < input.length; i++) ring[(frame + i) & mask] = input[i];
      written = frame + input.length;
      detector.push(input, frame, onOnset);
      for (let k = 0; k < live; ) {
        const p = pool[k];
        if (!p.decided && p.fastAt <= written) decideFast(p);
        const done = p.decided && (p.finalAt < 0 || !final || p.finalAt <= written);
        if (p.decided && p.finalAt >= 0 && final && p.finalAt <= written) decideFinal(p);
        if (done) {
          // Swap the finished one out with the last live entry (the pool keeps its objects).
          pool[k] = pool[live - 1];
          pool[live - 1] = p;
          live--;
        } else k++;
      }
      if (snippetsDue.length) sendSnippets();
      sampler.render(output);
      if (levelEvery > 0) {
        for (let i = 0; i < input.length; i++) {
          const x = input[i];
          levelSum += x * x;
          const a = x < 0 ? -x : x;
          if (a > levelPeak) levelPeak = a;
        }
        levelN += input.length;
        if (levelN >= levelEvery) {
          events.push({ kind: 'level', frame: written, rms: Math.sqrt(levelSum / levelN), peak: levelPeak });
          levelSum = 0;
          levelPeak = 0;
          levelN = 0;
        }
      }
      return events;
    },
    configure(message) {
      const m = message as SoundMapperMessage;
      switch (m.type) {
        case 'model':
          fast = m.fast ? createSoundClassifier(m.fast) : null;
          final = m.final ? createSoundClassifier(m.final) : null;
          if (m.mapping) mapping = { ...m.mapping };
          if (m.refPeak !== undefined) refPeak = m.refPeak;
          break;
        case 'mapping':
          mapping = { ...m.mapping };
          break;
        case 'sample':
          sampler.setSample(m.id, m.data);
          break;
        case 'params':
          if (m.velocity !== undefined) velocity = m.velocity;
          if (m.gain !== undefined) gain = m.gain;
          if (m.refPeak !== undefined) refPeak = m.refPeak;
          break;
        case 'capture':
          capture = m.on;
          if (!capture) snippetsDue.length = 0;
          break;
        case 'stop':
          sampler.stopAll();
          break;
        default:
          break;
      }
    },
  };
}
