/**
 * `SlotContract` — what a node must declare to fill a role-typed swap point.
 *
 * A slot's contract is structural, and deliberately small: the engine's
 * `validateEdge` accepts an edge only if the target node DECLARES an input port
 * of that name, so port *names* are what make a swap edge-stable. Everything
 * else here is a pre-flight the slot resolver runs so a bad swap is caught
 * before an Engine is constructed rather than as a wiring error afterwards.
 *
 * This interface lives on its own (rather than being inferred from the first
 * contract that happened to be written) so every slot's contract is the same
 * shape: `src/app/graph.ts`'s `slotFillReason` checks all of them identically,
 * and adding a slot is adding data, not a code path.
 */
import type { PortSpec, Role } from '@/dag';

export interface SlotContract {
  /** The advisory role a candidate must carry. */
  role: Role;
  /**
   * Input port NAMES a candidate must declare, so the default graph's edges into
   * the slot stay valid across a swap. Empty for slots whose candidates are
   * zero-input (sources).
   */
  requiredInputs: readonly string[];
  /** The output port a candidate must emit — name and `kind` are both checked. */
  output: PortSpec;
}
