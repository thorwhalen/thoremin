/**
 * `defineNode` — the ergonomic way to author a node definition.
 *
 * Two flavours:
 *  - **Pure nodes** (the common case): supply only `process(inputs, params, ctx)`.
 *    No per-instance state, trivially unit-testable.
 *  - **Stateful nodes**: supply `make(params) => NodeHandlers` to close over
 *    per-instance state (a synth voice, a smoothing filter, a websocket).
 *
 * Both produce a {@link NodeDef}; the engine treats them identically.
 */
import { z } from 'zod';
import type { NodeContext, NodeDef, NodeHandlers, ParamsSchema, PortSpec, PortValues, Role } from './types';

/** Fields common to both node-spec flavours. */
interface BaseNodeSpec<P> {
  type: string;
  title?: string;
  description?: string;
  /** Advisory role tag(s) (see {@link Role}); never gates execution. */
  roles?: Role[];
  inputs: PortSpec[];
  outputs: PortSpec[];
  /** Defaults to an empty-object schema when omitted. */
  params?: ParamsSchema<P>;
}

/** Spec for a pure (stateless) node. */
interface PureNodeSpec<P> extends BaseNodeSpec<P> {
  /** Pure transform: inputs + params -> outputs. */
  process(inputs: PortValues, params: P, ctx: NodeContext): PortValues;
}

/** Spec for a stateful node (owns per-instance state via a factory). */
interface StatefulNodeSpec<P> extends BaseNodeSpec<P> {
  /** Build per-instance handlers from validated params. */
  make(params: P): NodeHandlers;
}

const EMPTY_PARAMS = z.object({}).passthrough();

function hasMake<P>(spec: PureNodeSpec<P> | StatefulNodeSpec<P>): spec is StatefulNodeSpec<P> {
  return typeof (spec as StatefulNodeSpec<P>).make === 'function';
}

/**
 * Define a node. Pass either `process` (pure) or `make` (stateful).
 */
export function defineNode<P = Record<string, never>>(
  spec: PureNodeSpec<P> | StatefulNodeSpec<P>,
): NodeDef<P> {
  const params = (spec.params ?? (EMPTY_PARAMS as unknown as ParamsSchema<P>)) as ParamsSchema<P>;

  const make: (p: P) => NodeHandlers = hasMake(spec)
    ? spec.make
    : (p: P) => ({
        process: (inputs: PortValues, ctx: NodeContext) => spec.process(inputs, p, ctx),
      });

  return {
    type: spec.type,
    title: spec.title,
    description: spec.description,
    roles: spec.roles,
    inputs: spec.inputs,
    outputs: spec.outputs,
    params,
    make,
  };
}
