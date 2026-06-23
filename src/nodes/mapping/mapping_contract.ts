/**
 * The mapping-slot contract — the shared, exported input/output port surface that
 * any node intending to fill the `mapping` slot (hand features + live controls →
 * `synth-params`) must declare. This is the load-bearing prerequisite for
 * node-swap slots (see docs/design/component-model.md, "Two corrections" #1):
 *
 * `validateEdge` (src/dag/engine.ts) accepts an edge only if the target node
 * DECLARES an input port of that name. The default graph wires nine edges into
 * the mapping slot (features + face + the keyboard/UI control surface). So a node
 * can only be swapped into that slot without orphaning those edges if it declares
 * the same input port NAMES — which it guarantees by spreading these specs.
 *
 * Structural contract only: port *names* are what the engine checks; `kind` is
 * advisory (never runtime-enforced), per the design doc's deliberate stance. No
 * Zod validator and no kind enforcement here — "a shared TS type on the swap
 * contract is free and enough".
 *
 * Today `voice-mapping` is the sole implementation; the contract makes the next
 * hand-features→synth-params mapping a clean, edge-stable drop-in.
 */
import type { PortSpec, Role } from '@/dag';

/**
 * Input ports every mapping-slot node must declare so the default graph's
 * features/face/control edges stay valid across a swap. Spread into `inputs`.
 */
export const MAPPING_SLOT_INPUTS: PortSpec[] = [
  { name: 'features', kind: 'hand-features' },
  // Live control side-inputs (from keyboard-control); unconnected → static params.
  { name: 'magnetism', kind: 'number', description: 'Override magnetism 0..1' },
  { name: 'octaveShift', kind: 'number', default: 0, description: 'Transpose by N octaves' },
  { name: 'mute', kind: 'boolean', default: false },
  // Live scale/instrument overrides (from store-controls).
  { name: 'scaleRight', kind: 'number[]' },
  { name: 'scaleLeft', kind: 'number[]' },
  { name: 'instrumentRight', kind: 'instrument' },
  { name: 'instrumentLeft', kind: 'instrument' },
  // Optional facial expression (from face-features).
  { name: 'face', kind: 'face-features' },
];

/** The output port a mapping-slot node must emit (consumed by synth + overlay). */
export const MAPPING_SLOT_OUTPUT: PortSpec = { name: 'params', kind: 'synth-params' };

/**
 * What a candidate node must satisfy to fill the mapping slot: the advisory role,
 * the required input port names (engine checks these), and the output port
 * name+kind (so downstream `synth`/`overlay` edges keep working). Consumed by the
 * slot resolver's validation in `src/app/graph.ts`.
 */
export const MAPPING_SLOT_CONTRACT = {
  role: 'mapping' as Role,
  requiredInputs: MAPPING_SLOT_INPUTS.map((p) => p.name),
  output: MAPPING_SLOT_OUTPUT,
} as const;

export type SlotContract = typeof MAPPING_SLOT_CONTRACT;
