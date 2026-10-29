/**
 * The offline harness: run an audio-thread analyser over a recorded signal exactly as the
 * AudioWorklet would, one render quantum at a time, and keep what it emitted, what it played
 * and what each quantum cost (`docs/research/audio-trigger-latency.md`).
 *
 * This is the real-time test that needs no real time: the analyser cannot tell a quantum fed
 * from a file from one fed by a microphone, so the latency it adds (from a known onset in the
 * input to the first sample of its answer in the output), its decisions and its per-quantum
 * cost are measured to the sample, deterministically, in CI.
 */
import type { AudioAnalyser, AudioEvent } from './types';

/** The Web Audio render quantum (fixed at 128 frames by the spec, until `renderSizeHint` ships). */
export const RENDER_QUANTUM = 128;

export interface OfflineRun {
  output: Float32Array;
  events: AudioEvent[];
  /** Wall time each quantum's `process` took, ms. */
  quantumMs: Float64Array;
}

export interface OfflineOptions {
  quantum?: number;
  /** Context frame of the first sample. */
  startFrame?: number;
  /** A clock for the per-quantum cost (default `performance.now`). */
  now?: () => number;
}

export function runOffline(analyser: AudioAnalyser, input: Float32Array, options: OfflineOptions = {}): OfflineRun {
  const q = options.quantum ?? RENDER_QUANTUM;
  const start = options.startFrame ?? 0;
  const now = options.now ?? (() => performance.now());
  const blocks = Math.ceil(input.length / q);
  const output = new Float32Array(blocks * q);
  const events: AudioEvent[] = [];
  const quantumMs = new Float64Array(blocks);
  const inBlock = new Float32Array(q);
  const outBlock = new Float32Array(q);
  for (let b = 0; b < blocks; b++) {
    inBlock.fill(0);
    inBlock.set(input.subarray(b * q, Math.min(input.length, (b + 1) * q)));
    outBlock.fill(0);
    const t0 = now();
    const evs = analyser.process(inBlock, outBlock, start + b * q);
    quantumMs[b] = now() - t0;
    for (const e of evs) events.push(e);
    output.set(outBlock, b * q);
  }
  return { output, events, quantumMs };
}

/** The first frame at or after `from` where `|signal|` exceeds `threshold`, or -1. */
export function firstAbove(signal: Float32Array, from: number, threshold: number, until = signal.length): number {
  for (let i = Math.max(0, from); i < Math.min(until, signal.length); i++) if (Math.abs(signal[i]) > threshold) return i;
  return -1;
}
