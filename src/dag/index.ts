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
export type { EngineOptions, GraphChange } from './engine';
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
export { Applier } from './applier';
export type { ApplierOptions, Source, SourceContext } from './applier';

import { Engine, type EngineOptions } from './engine';
import { NodeRegistry } from './registry';
import { StreamRecorder } from './recorder';
import { BatchClock } from './clock';
import { Applier } from './applier';
import type { GraphSpec } from './types';

/**
 * Build, init and tick a graph headlessly for `ticks` ticks, returning the
 * engine and a {@link StreamRecorder} capturing every edge. The default driver
 * for end-to-end DAG tests and for the `record` CLI script.
 *
 * Port conformance ({@link EngineOptions.validatePorts}) defaults **on** here:
 * this is the batch path the check was designed for, and a fixture recorded
 * from a node that emitted a malformed frame is worse than a failing run. Pass
 * `validatePorts: false` to opt out.
 */
export async function runHeadless(
  spec: GraphSpec,
  registry: NodeRegistry,
  opts: { ticks: number; recordOnly?: string[] } & Omit<EngineOptions, 'taps'> = { ticks: 1 },
): Promise<{ engine: Engine; recorder: StreamRecorder }> {
  const recorder = new StreamRecorder({ only: opts.recordOnly });
  // Resolve the gate explicitly rather than by spread order: a caller forwarding
  // an optional flag (`validatePorts: cfg.validate` where cfg.validate is unset)
  // passes the KEY with value undefined, and a spread would let that overwrite
  // the default with undefined — which Engine then reads as false, silently
  // turning the gate off in exactly the batch runs it exists for.
  const engine = new Engine(spec, registry, {
    ...opts,
    validatePorts: opts.validatePorts ?? true,
    taps: [recorder],
  });
  await engine.init();
  // Batch is an Applier config: a BatchClock, one recording tap, no sources and no
  // sinks. The Applier forwards the clock's time argument verbatim, and BatchClock
  // passes none, so the engine synthesizes `tickIndex * nominalDt` exactly as the
  // original inline for-loop did — recorded goldens are byte-identical, which
  // `test/applier_byte_identity.test.ts` pins rather than merely asserts.
  await new Applier({ engine, clock: new BatchClock(opts.ticks) }).run();
  return { engine, recorder };
}
