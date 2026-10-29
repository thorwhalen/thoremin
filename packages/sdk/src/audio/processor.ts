/**
 * The AudioWorklet processor's logic, without the worklet (`docs/design/audio-input.md`): the
 * thin shell in `src/audio/audio_in.worklet.ts` forwards `process` and port messages here,
 * so everything it decides is tested in node.
 *
 * It holds a chain of analysers that the host adds and removes while running (each consumer of
 * the microphone brings its own), routes the host's messages to them by id, and batches what
 * they emit: one port message per render quantum, and only when something happened. A snippet's
 * audio is transferred, not copied. An optional raw-PCM tap (a recorder's) posts the input in
 * chunks, counting the quanta it had to drop when the host fell behind.
 */
import type { AnalyserMessage, AudioAnalyser, AudioEvent } from './types';
import { ANALYSERS, createAnalyser, type AnalyserFactory, type AnalyserSpec } from './analysers';

/** Host to processor. */
export type ProcessorInMessage =
  | { type: 'add'; id: string; spec: AnalyserSpec }
  | { type: 'remove'; id: string }
  | { type: 'to'; id: string; message: AnalyserMessage }
  | { type: 'pcm'; on: boolean; chunk?: number }
  | { type: 'ack'; upTo: number };

/** One event and the analyser (by the host's id) that emitted it. */
export interface PostedEvent {
  source: string;
  event: AudioEvent;
}

/** Processor to host. */
export type ProcessorOutMessage =
  | { type: 'events'; frame: number; events: PostedEvent[] }
  | { type: 'pcm'; frame: number; pcm: Float32Array; dropped: number; seq: number }
  | { type: 'error'; id: string; message: string };

export interface ProcessorCoreOptions {
  sampleRate: number;
  post: (message: ProcessorOutMessage, transfer?: Transferable[]) => void;
  table?: Record<string, AnalyserFactory>;
  /** Raw-PCM chunks in flight (posted, not yet acknowledged) before new ones are dropped. */
  maxPcmInFlight?: number;
}

export interface ProcessorCore {
  /** One render quantum: `input` may be empty (nothing connected); `output` is overwritten. */
  process(input: Float32Array | undefined, output: Float32Array, frame: number): void;
  message(m: ProcessorInMessage): void;
  ids(): string[];
}

export function createProcessorCore(o: ProcessorCoreOptions): ProcessorCore {
  const table = o.table ?? ANALYSERS;
  const list: { id: string; analyser: AudioAnalyser }[] = [];
  let silence = new Float32Array(128);
  let pcmOn = false;
  let chunk = 2048;
  let pcm = new Float32Array(chunk);
  let pcmFill = 0;
  let pcmStart = 0;
  let seq = 0;
  let acked = 0;
  let dropped = 0;
  const maxInFlight = o.maxPcmInFlight ?? 8;

  const tapPcm = (input: Float32Array, frame: number) => {
    if (pcmFill === 0) pcmStart = frame;
    let i = 0;
    while (i < input.length) {
      const n = Math.min(input.length - i, chunk - pcmFill);
      pcm.set(input.subarray(i, i + n), pcmFill);
      pcmFill += n;
      i += n;
      if (pcmFill === chunk) {
        if (seq - acked < maxInFlight) {
          const out = pcm;
          o.post({ type: 'pcm', frame: pcmStart, pcm: out, dropped, seq: seq++ }, [out.buffer]);
          dropped = 0;
          pcm = new Float32Array(chunk);
        } else dropped += chunk;
        pcmFill = 0;
        pcmStart = frame + i;
      }
    }
  };

  return {
    process(input, output, frame) {
      output.fill(0);
      let x = input;
      if (!x || x.length === 0) {
        if (silence.length !== output.length) silence = new Float32Array(output.length);
        x = silence;
      }
      let batch: PostedEvent[] | null = null;
      let transfer: Transferable[] | null = null;
      for (const { id, analyser } of list) {
        let evs: readonly AudioEvent[];
        try {
          evs = analyser.process(x, output, frame);
        } catch (e) {
          // One analyser failing must not silence the others or kill the processor.
          o.post({ type: 'error', id, message: String((e as Error)?.message ?? e) });
          continue;
        }
        for (const e of evs) {
          (batch ??= []).push({ source: id, event: e });
          if (e.kind === 'snippet') (transfer ??= []).push(e.pcm.buffer);
        }
      }
      if (batch) o.post({ type: 'events', frame, events: batch }, transfer ?? undefined);
      if (pcmOn) tapPcm(x, frame);
    },
    message(m) {
      switch (m.type) {
        case 'add': {
          const at = list.findIndex((x) => x.id === m.id);
          try {
            const analyser = createAnalyser(m.spec, o.sampleRate, table);
            if (at >= 0) list[at] = { id: m.id, analyser };
            else list.push({ id: m.id, analyser });
          } catch (e) {
            o.post({ type: 'error', id: m.id, message: String((e as Error)?.message ?? e) });
          }
          break;
        }
        case 'remove': {
          const at = list.findIndex((x) => x.id === m.id);
          if (at >= 0) list.splice(at, 1);
          break;
        }
        case 'to':
          list.find((x) => x.id === m.id)?.analyser.configure?.(m.message);
          break;
        case 'pcm':
          pcmOn = m.on;
          if (m.chunk && m.chunk !== chunk) {
            chunk = Math.max(128, Math.round(m.chunk));
            pcm = new Float32Array(chunk);
          }
          pcmFill = 0;
          dropped = 0;
          break;
        case 'ack':
          acked = Math.max(acked, m.upTo + 1);
          break;
        default:
          break;
      }
    },
    ids: () => list.map((x) => x.id),
  };
}
