/**
 * `defineMergeNode` — the R2 composition primitive (#101 M-E).
 *
 * The engine **rejects fan-in to a single input port**: one edge per port, by design, so
 * that a node's inputs are unambiguous and a graph's data flow is readable. That makes
 * combining two streams an explicit, typed decision rather than an accident of wiring
 * order — which is right, and which is also why merging needs a node.
 *
 * This is the factory for that node. Two same-kind inputs, one same-kind output, and a
 * `combine` the caller supplies:
 *
 * ```ts
 * const mergeHands = defineMergeNode({
 *   type: 'merge-hands',
 *   kind: 'hands-frame',
 *   combine: (a, b) => (a ?? b),          // primary wins, secondary is the fallback
 * });
 * ```
 *
 * ## What `combine` is and is not called with
 *
 * It is called **every tick**, including ticks where one or both sides are `undefined` —
 * a source that has not produced yet, a clip that ended, a node upstream of a slot that
 * is not filled. Deciding what an absent side means is the merge's whole job, so it is
 * the caller's to make: "primary wins", "sum them", "the newer one", "drop the frame".
 * Handing `combine` only the both-present case would push that decision into the engine,
 * where it cannot be right for every kind.
 *
 * The one case the factory keeps is **both absent**: it emits nothing, so a merge of two
 * silent inputs is silent rather than a stream of `combine(undefined, undefined)`. A node
 * that emits nothing on a port it declares is what `EngineOptions.validatePorts` exists
 * to catch, and this is the honest reading of it — there was nothing to merge.
 *
 * ## Timestamps
 *
 * v0 merges on the **shared tick grid**: both inputs are whatever their edges carried on
 * this tick. Sub-tick ordering is lost by design (latch-and-sample), which is why `event`
 * sources accumulate into a list in the Applier rather than latching — the coalescing
 * happens there, before the merge sees it. Timestamp-aware *resampling* to `ctx.time`
 * belongs to the timed replay source, not here: a merge cannot resample what it is handed
 * after the fact.
 */
import { z } from 'zod';
import { defineNode } from './node';
import type { NodeDef, PortValues, Role } from './types';

/** The two input port names a merge node declares. Fixed so a graph reads the same
 *  wherever a merge appears, and so tooling can recognise one. */
export const MERGE_INPUTS = ['a', 'b'] as const;
/** The single output port name. */
export const MERGE_OUTPUT = 'merged' as const;

export interface MergeNodeSpec<T> {
  /** Node type id, e.g. `'merge-hands'`. */
  type: string;
  /** The port kind of both inputs and the output — a merge is kind-preserving. */
  kind: string;
  title?: string;
  description?: string;
  roles?: Role[];
  /**
   * Combine one tick's pair. Either side may be `undefined` (see the module docstring);
   * returning `undefined` emits nothing for that tick.
   */
  combine(a: T | undefined, b: T | undefined): T | undefined;
}

/**
 * Build a kind-preserving two-input merge node.
 *
 * Pure and stateless: the same pair always merges the same way, so a merged graph stays
 * replayable and its recorded stream reproduces exactly.
 */
export function defineMergeNode<T = unknown>(spec: MergeNodeSpec<T>): NodeDef<Record<string, never>> {
  return defineNode({
    type: spec.type,
    title: spec.title,
    description: spec.description ?? `Merge two ${spec.kind} streams on the shared tick grid.`,
    roles: spec.roles ?? ['mapping'],
    inputs: MERGE_INPUTS.map((name) => ({ name, kind: spec.kind })),
    outputs: [{ name: MERGE_OUTPUT, kind: spec.kind }],
    params: z.object({}).passthrough() as never,
    process: (inputs: PortValues): PortValues => {
      const a = inputs[MERGE_INPUTS[0]] as T | undefined;
      const b = inputs[MERGE_INPUTS[1]] as T | undefined;
      // Both absent: nothing to merge, so emit nothing rather than manufacture a value.
      if (a === undefined && b === undefined) return {};
      const merged = spec.combine(a, b);
      return merged === undefined ? {} : { [MERGE_OUTPUT]: merged };
    },
  });
}
