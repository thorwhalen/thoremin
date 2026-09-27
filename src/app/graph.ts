/**
 * The default Thoremin instrument graph — the wiring that makes hand gestures play
 * tonal audio with overlays, steerable live by keyboard + UI.
 *
 *   webcam ─┬─▶ hand-features ─┬─▶ voice-mapping ─▶ synth-merge ─▶ webaudio-synth
 *           │                  │        ▲                ▲
 *           └────────▶ overlay ◀┘        │ store-controls (ui): scale/sound/octave/
 *                       (video+guides)   │ magnetism/mute; keyboard shortcuts live app-side
 *   webcam-face ─┬─▶ face-features ──────┘ (timbre: smile→brightness, mouth→vibrato)
 *                └─▶ face-expression ─▶ expression-chord ─▶ synth-merge
 *
 * Since the instruments-as-graphs ADR (`docs/design/instruments-as-graphs-and-extensions.md`)
 * this file no longer lists nodes and edges. The graph is COMPOSED from BRANCHES
 * (`src/instruments/branches.ts`): the trunk every instrument shares (hands, the UI
 * bridge, the merge, the synth, the overlay) plus one branch per capability (the field
 * voices, the face source and its consumers, the body, the conductor, MIDI out, the
 * generative model, the four air instruments). `defaultGraph()` composes every branch, so
 * it builds the same 32-node graph it always did (`test/instruments/golden_graph.test.ts`
 * pins that); an instrument that names fewer branches gets fewer nodes (PR 3 of the ADR).
 *
 * What stays here is the SLOTS table: the role-typed swap points a branch node may fill
 * (`{ id: 'cam', slot: 'source' }`), their candidates, their contracts, and the URL
 * selection (`?slot.source=synthetic-hands`). A slot chooses a node TYPE inside a branch;
 * a branch chooses which nodes EXIST. They compose.
 *
 * One output may fan OUT to several inputs (webcam→features & overlay); only fan-IN to a
 * single input port is disallowed, which is why every voice goes through `synth-merge`.
 */
import type { GraphSpec, NodeRegistry, Role } from '@thoremin/dag';
import { MAPPING_SLOT_CONTRACT } from '@/nodes/mapping/mapping_contract';
import { SOURCE_SLOT_CONTRACT } from '@/nodes/sources/source_contract';
import { BODY_SLOT_CONTRACT } from '@/nodes/sources/body_contract';
import { EXPRESSION_SLOT_CONTRACT } from '@/nodes/features/expression_contract';
import type { SlotContract } from '@/nodes/slot_contract';
import { SYNTH_MERGE_POOLS } from '@/nodes/mapping/synth_merge';
import { DEFAULT_STEER_CONFIG } from '@/settings/schema';
import { composeGraph, type Composed } from '@/instruments/compose';
import { BRANCHES, TRUNK, trunk } from '@/instruments/branches';
import { EXTENSIONS, EXTENSION_BRANCHES } from '@/extensions';
import { deriveBranchIds, type DerivationContext, type DerivationSettings, type DerivationTable } from '@/instruments/derive';
import { assembleSpecWith, type InstrumentSpec, type SpecParts } from '@/instruments/spec';

/** The full branch table this build composes from: the core branches, then every extension's. */
export const ALL_BRANCHES = [...BRANCHES, ...EXTENSION_BRANCHES];
export const ALL_BRANCH_IDS: readonly string[] = ALL_BRANCHES.map((b) => b.id);

/** What the derivation knows in THIS build: every branch id, and each extension's derivation. */
export const DERIVATION_TABLE: DerivationTable = { knownBranchIds: new Set(ALL_BRANCH_IDS), extensions: EXTENSIONS };

/**
 * The branch ids the settings and the live demand imply, in this build (core plus every
 * extension). The pure derivation is `deriveBranchIds` in `src/instruments/derive.ts`; this
 * is the one place it is bound to the extension list.
 */
export function branchIdsFor(settings: DerivationSettings, ctx: DerivationContext = {}): string[] {
  return deriveBranchIds(settings, ctx, DERIVATION_TABLE);
}

/** The instrument spec assembled against this build's full branch table. */
export function assembleSpec(parts: SpecParts): InstrumentSpec {
  return assembleSpecWith(parts, ALL_BRANCHES);
}

/**
 * The generative branch's STARTER steering (#141 / #188): what the gestures mean to
 * the engine until the player edits `steerConfig`. Build-time params of `indirect-map`
 * (its `steerConfig` port overrides them live). The SAME object as the settings
 * default (`DEFAULT_STEER_CONFIG`), so an instrument that never touched the dial and
 * one that holds the default agree exactly. Exported for the tests.
 */
export const STARTER_STEER = DEFAULT_STEER_CONFIG;

/**
 * A slot is a named swap point in the graph: a role, a default node type, the candidate
 * types a URL may choose, and the contract every candidate must satisfy (the ports the
 * graph wires, so a swap never leaves an edge dangling). See `component-model.md`.
 */
export interface SlotDef {
  role: Role;
  default: string;
  candidates: string[];
  contract: SlotContract;
}

export const SLOTS: Record<string, SlotDef> = {
  mapping: {
    role: 'mapping',
    default: 'voice-mapping',
    candidates: ['voice-mapping'],
    contract: MAPPING_SLOT_CONTRACT,
  },
  source: {
    role: 'source',
    default: 'webcam-hands',
    candidates: ['webcam-hands', 'synthetic-hands', 'replay-hands'],
    contract: SOURCE_SLOT_CONTRACT,
  },
  body: {
    role: 'source',
    default: 'webcam-body',
    candidates: ['webcam-body', 'synthetic-body', 'replay-body'],
    contract: BODY_SLOT_CONTRACT,
  },
  // The face's expression classifier (the ADR's seam 7). One candidate today; the
  // pointable second is the Trainer's learned classifier (`src/enroll/classify.ts`) once
  // an adapter emits the `face-expression` kind. Declared so the seam exists; no UI.
  expression: {
    role: 'feature',
    default: 'face-expression',
    candidates: ['face-expression'],
    contract: EXPRESSION_SLOT_CONTRACT,
  },
};

export type SlotSelection = Partial<Record<keyof typeof SLOTS, string>>;

export const NO_SLOTS: SlotSelection = Object.freeze({});

/** `?slot.<name>=<nodeType>` for each slot the URL names. */
export function parseSlotSelection(search: string): SlotSelection {
  const params = new URLSearchParams(search);
  const selection: SlotSelection = {};
  for (const key of Object.keys(SLOTS) as (keyof typeof SLOTS)[]) {
    const chosen = params.get(`slot.${key}`)?.trim();
    if (chosen) selection[key] = chosen;
  }
  return selection;
}

/**
 * Whether the resolved source needs the camera. The host reads this BEFORE acquiring
 * anything: a slot alone would leave the camera-free URL still calling `getUserMedia`.
 */
export function sourceNeedsVideo(selection?: SlotSelection, registry?: NodeRegistry): boolean {
  return resolveSlot('source', selection, registry) === SLOTS.source.default;
}

/** A stable string for a selection, so React effects can depend on it by value. */
export function slotSelectionKey(selection: SlotSelection = NO_SLOTS): string {
  return (Object.keys(SLOTS) as (keyof typeof SLOTS)[])
    .map((k) => `${k}=${selection[k] ?? ''}`)
    .join('&');
}

/** Why `type` cannot fill `slot`, or null when it can. Checked against the contract. */
function slotFillReason(type: string, slot: SlotDef, registry: NodeRegistry): string | null {
  if (!registry.has(type)) return 'is not a registered node type';
  const def = registry.get(type);
  if (!def.roles?.includes(slot.role)) return `does not carry role "${slot.role}"`;
  const out = def.outputs.find((p) => p.name === slot.contract.output.name);
  if (!out) return `has no output port "${slot.contract.output.name}"`;
  if (out.kind !== slot.contract.output.kind) {
    return `output "${out.name}" is kind "${out.kind}", not "${slot.contract.output.kind}"`;
  }
  const inputNames = new Set(def.inputs.map((p) => p.name));
  const missing = slot.contract.requiredInputs.filter((n) => !inputNames.has(n));
  if (missing.length) return `is missing required input ports: ${missing.join(', ')}`;
  return null;
}

/**
 * The node type that fills `slotKey`: the selection's choice when it is a valid candidate
 * (registered, carries the role, satisfies the contract), otherwise the default, with a
 * warning. Without a registry nothing can be validated, so the default wins.
 */
export function resolveSlot(
  slotKey: keyof typeof SLOTS,
  selection?: SlotSelection,
  registry?: NodeRegistry,
  warn: (msg: string) => void = (m) => console.warn(m),
): string {
  const slot = SLOTS[slotKey];
  const chosen = selection?.[slotKey];
  if (!chosen || chosen === slot.default) return slot.default;
  if (!registry) {
    warn(`Slot "${slotKey}": cannot validate "${chosen}" without a registry; using "${slot.default}".`);
    return slot.default;
  }
  const reason = slotFillReason(chosen, slot, registry);
  if (reason) {
    warn(`Slot "${slotKey}": "${chosen}" ${reason}; falling back to "${slot.default}".`);
    return slot.default;
  }
  return chosen;
}

/** Every slot resolved for a selection: slot name → node type. */
export function resolveSlots(selection?: SlotSelection, registry?: NodeRegistry): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(SLOTS) as (keyof typeof SLOTS)[]) out[key] = resolveSlot(key, selection, registry);
  return out;
}

/** Where declared voices go: the trunk's merge node and its role pools. */
export const MERGE_TARGET = { node: TRUNK.merge, pools: SYNTH_MERGE_POOLS } as const;

/**
 * Compose the named branches (requirements included) for a slot selection. The general
 * form of {@link defaultGraph}; PR 3 of the ADR feeds it the branch set an instrument's
 * settings and the live feature demand imply.
 */
export function composeInstrumentGraph(
  branchIds: readonly string[],
  selection?: SlotSelection,
  registry?: NodeRegistry,
): Composed {
  // The trunk is implied: every instrument shares it, so no spec has to name it.
  const ids = branchIds.includes(trunk.id) ? branchIds : [trunk.id, ...branchIds];
  return composeGraph(ids, ALL_BRANCHES, { slots: resolveSlots(selection, registry), merge: MERGE_TARGET });
}

/** The full graph: every branch. The selection swaps node types inside it (see SLOTS). */
export function defaultGraph(selection?: SlotSelection, registry?: NodeRegistry): GraphSpec {
  return composeInstrumentGraph(ALL_BRANCH_IDS, selection, registry).spec;
}
