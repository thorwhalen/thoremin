/**
 * Thoremin DAG runtime — public surface.
 *
 * A typed, framework-agnostic dataflow graph: define nodes, wire them into a
 * GraphSpec, run them tick-by-tick, and tap/record/replay any edge. Zero React,
 * DOM or audio dependencies so it runs in plain Node for fast unit tests.
 */
export * from './types';
export { defineNode } from './node';
export { NodeRegistry, createRegistry } from './registry';
export { Engine } from './engine';
export type { EngineOptions } from './engine';
export {
  StreamRecorder,
  serializeRecords,
  parseRecords,
  valuesFromNDJSON,
  replayNode,
} from './recorder';
export type { ReplayOptions } from './recorder';
export { BatchClock, RealtimeClock } from './clock';
export type { Clock, RealtimeClockOptions } from './clock';

import { Engine, type EngineOptions } from './engine';
import { NodeRegistry } from './registry';
import { StreamRecorder } from './recorder';
import { BatchClock } from './clock';
import type { GraphSpec } from './types';

/**
 * Build, init and tick a graph headlessly for `ticks` ticks, returning the
 * engine and a {@link StreamRecorder} capturing every edge. The default driver
 * for end-to-end DAG tests and for the `record` CLI script.
 */
export async function runHeadless(
  spec: GraphSpec,
  registry: NodeRegistry,
  opts: { ticks: number; recordOnly?: string[] } & Omit<EngineOptions, 'taps'> = { ticks: 1 },
): Promise<{ engine: Engine; recorder: StreamRecorder }> {
  const recorder = new StreamRecorder({ only: opts.recordOnly });
  const engine = new Engine(spec, registry, { ...opts, taps: [recorder] });
  await engine.init();
  // BatchClock calls engine.tick() with no argument, exactly as the previous
  // inline for-loop did, so recorded goldens are byte-identical.
  await new BatchClock(opts.ticks).run(() => engine.tick(), () => false);
  return { engine, recorder };
}
