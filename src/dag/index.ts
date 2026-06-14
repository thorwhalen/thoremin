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

import { Engine, type EngineOptions } from './engine';
import { NodeRegistry } from './registry';
import { StreamRecorder } from './recorder';
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
  for (let i = 0; i < opts.ticks; i++) engine.tick();
  return { engine, recorder };
}
