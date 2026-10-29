/**
 * The analysers the audio thread can run, by name: the one table the AudioWorklet processor
 * bundle imports and the offline loop runs, so a test or a script runs exactly the code a
 * player's microphone does (`docs/design/audio-input.md`, "analysers by name").
 *
 * Adding an analyser is a new module with a `create...(options)` returning an `AudioAnalyser`,
 * and ONE entry here. Nothing in the processor, the host or the graph node changes.
 */
import type { AnalyserMessage, AudioAnalyser, AudioEvent } from './types';
import { createOnsetDetector, type OnsetOptions } from './onset';
import { createSoundMapper, type SoundMapperOptions } from './mapper';
import { runOffline } from './offline';
import { createPitchAnalyser, type PitchAnalyserOptions } from './pitch';
import { createFormantAnalyser, type FormantOptions } from './formants';

export interface AnalyserContext {
  sampleRate: number;
  params?: Record<string, unknown>;
}

export type AnalyserFactory = (ctx: AnalyserContext) => AudioAnalyser;

export interface OnsetAnalyserOptions extends Partial<Omit<OnsetOptions, 'sampleRate'>> {
  /** A level event every this many ms (0 = none). */
  levelEveryMs?: number;
}

/**
 * Every onset of the input, and its level: what a rhythm consumer reads (a clap trainer, a tap
 * tempo). It never classifies; the sound mapper is a separate analyser with its own onsets.
 */
export function createOnsetAnalyser(sampleRate: number, options: OnsetAnalyserOptions = {}): AudioAnalyser {
  const { levelEveryMs = 50, ...onset } = options;
  const detector = createOnsetDetector({ sampleRate, ...onset });
  const levelEvery = levelEveryMs > 0 ? Math.round((levelEveryMs / 1000) * sampleRate) : 0;
  const events: AudioEvent[] = [];
  let sum = 0;
  let peak = 0;
  let n = 0;
  const push = (o: { frame: number; detectedFrame: number; strength: number }) => {
    events.push({ kind: 'onset', frame: o.frame, detectedFrame: o.detectedFrame, strength: o.strength });
  };
  return {
    process(input, _output, frame) {
      events.length = 0;
      detector.push(input, frame, push);
      if (levelEvery > 0) {
        for (let i = 0; i < input.length; i++) {
          const x = input[i];
          sum += x * x;
          const a = x < 0 ? -x : x;
          if (a > peak) peak = a;
        }
        n += input.length;
        if (n >= levelEvery) {
          events.push({ kind: 'level', frame: frame + input.length, rms: Math.sqrt(sum / n), peak });
          sum = 0;
          peak = 0;
          n = 0;
        }
      }
      return events;
    },
  };
}

/** The table. Params are the analyser's own options, passed through as given. */
export const ANALYSERS: Record<string, AnalyserFactory> = {
  onset: ({ sampleRate, params }) => createOnsetAnalyser(sampleRate, params as OnsetAnalyserOptions),
  'sound-mapper': ({ sampleRate, params }) => createSoundMapper({ ...(params as Partial<SoundMapperOptions>), sampleRate }),
  // YIN, one `pitch` event per hop at its window's centre: the singing and play-along games (lane A of #866).
  pitch: ({ sampleRate, params }) => createPitchAnalyser(sampleRate, params as PitchAnalyserOptions),
  // LPC formants, one `formants` event per hop: the vowel games.
  formants: ({ sampleRate, params }) => createFormantAnalyser(sampleRate, params as FormantOptions),
};

export interface AnalyserSpec {
  /** The analyser's name in {@link ANALYSERS}. */
  name: string;
  /** Distinguishes two analysers of one name (default: the name). */
  id?: string;
  params?: Record<string, unknown>;
}

/** Make an analyser by name; throws with the known names for an unknown one. */
export function createAnalyser(spec: AnalyserSpec, sampleRate: number, table: Record<string, AnalyserFactory> = ANALYSERS): AudioAnalyser {
  const make = table[spec.name];
  if (!make) throw new Error(`unknown audio analyser "${spec.name}" (known: ${Object.keys(table).join(', ')})`);
  return make({ sampleRate, params: spec.params });
}

export interface TaggedEvent {
  /** The analyser's id. */
  source: string;
  event: AudioEvent;
}

/** Several analysers over one input, in order, adding into one output: the processor's loop. */
export interface AnalyserChain {
  readonly ids: readonly string[];
  /** One quantum; `emit` is called for every event, with the id of the analyser that made it. */
  process(input: Float32Array, output: Float32Array, frame: number, emit: (source: string, event: AudioEvent) => void): void;
  /** Send a message to one analyser by id (ignored for an unknown id or an analyser with no `configure`). */
  configure(id: string, message: AnalyserMessage): void;
}

export function createAnalyserChain(specs: readonly AnalyserSpec[], sampleRate: number, table: Record<string, AnalyserFactory> = ANALYSERS): AnalyserChain {
  const list = specs.map((s) => ({ id: s.id ?? s.name, analyser: createAnalyser(s, sampleRate, table) }));
  const ids = list.map((x) => x.id);
  if (new Set(ids).size !== ids.length) throw new Error(`two audio analysers share an id (${ids.join(', ')}); give one an id`);
  return {
    ids,
    process(input, output, frame, emit) {
      for (const { id, analyser } of list) for (const e of analyser.process(input, output, frame)) emit(id, e);
    },
    configure(id, message) {
      list.find((x) => x.id === id)?.analyser.configure?.(message);
    },
  };
}

/**
 * The worklet's loop without the worklet: `pcm` through the named analysers, one render quantum
 * at a time, every event tagged with the analyser that emitted it.
 */
export function runAnalysers(pcm: Float32Array, sampleRate: number, specs: readonly AnalyserSpec[], table: Record<string, AnalyserFactory> = ANALYSERS): TaggedEvent[] {
  const chain = createAnalyserChain(specs, sampleRate, table);
  const out: TaggedEvent[] = [];
  const none: AudioEvent[] = [];
  runOffline({ process: (input, output, frame) => (chain.process(input, output, frame, (source, event) => out.push({ source, event })), none) }, pcm);
  return out;
}
