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
import { synthMergePools } from '@/nodes/mapping/synth_merge.schema';
import { chordPool } from '@/nodes/mapping/chord_select.schema';
import { captionsPort, categoryPool } from '@/nodes/output/canvas_overlay.schema';
import { composeGraph, type CategoryTarget, type ChordTarget, type Composed } from '@/instruments/compose';
import { BRANCHES, TRUNK, trunk } from '@/instruments/branches';
import { assertNoCoreClash, CONTRIBUTIONS, overlayConfigEdges } from '@/host/contributions';
import { deriveBranchIds, type DerivationContext, type DerivationSettings, type DerivationTable } from '@/instruments/derive';
import { assembleSpecWith, type InstrumentSpec, type SpecParts } from '@/instruments/spec';

/** The full branch table this build composes from: the core branches, then every extension's. */
// An extension branch must not reuse a core branch id (the composer would see two).
assertNoCoreClash('branch', BRANCHES.map((b) => b.id), CONTRIBUTIONS.branches.map((b) => b.id));
export const ALL_BRANCHES = [...BRANCHES, ...CONTRIBUTIONS.branches];
export const ALL_BRANCH_IDS: readonly string[] = ALL_BRANCHES.map((b) => b.id);

/**
 * `branchIds` without every branch that names a node of one of `types`, and without every branch
 * that requires one of those (transitively, since the composer would add the required one back).
 * How the app still plays when a lazy extension's code failed to load: the graph is composed
 * without that extension's branches (`docs/design/lazy-extensions.md`).
 */
export function branchIdsWithout(branchIds: readonly string[], types: ReadonlySet<string>): string[] {
  if (types.size === 0) return [...branchIds];
  const dropped = new Set(ALL_BRANCHES.filter((b) => b.nodes.some((n) => n.type !== undefined && types.has(n.type))).map((b) => b.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of ALL_BRANCHES) {
      if (!dropped.has(b.id) && b.requires.some((r) => dropped.has(r))) {
        dropped.add(b.id);
        grew = true;
      }
    }
  }
  return branchIds.filter((id) => !dropped.has(id));
}

/** What the derivation knows in THIS build: every branch id, and each extension's derivation. */
export const DERIVATION_TABLE: DerivationTable = { knownBranchIds: new Set(ALL_BRANCH_IDS), extensions: CONTRIBUTIONS.extensions, implying: ALL_BRANCHES };

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

/** The slots the shell declares, with core's own candidates; an extension adds candidates (and a
 *  default) through `slotCandidates` (#600 S17), folded in {@link SLOTS}. */
const CORE_SLOTS: Record<string, SlotDef> = {
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
  // The face's expression classifier (the ADR's seam 7). One candidate. A player's own
  // categorizer (#330 P4) is chosen per instrument and swaps in by branch replacement, not
  // here: see `src/nodes/features/expression_contract.ts`. Declared so the seam exists; no UI.
  expression: {
    role: 'feature',
    default: 'face-expression',
    candidates: ['face-expression'],
    contract: EXPRESSION_SLOT_CONTRACT,
  },
};

/** The shell's slots with the extensions' candidates folded in (#600 S17). A slot an extension
 *  names that the shell does not declare is refused: the shell owns the slots and contracts. */
export function withSlotCandidates(core: Record<string, SlotDef>, contributed: Readonly<Record<string, { types: readonly string[]; default?: string }>>): Record<string, SlotDef> {
  const out: Record<string, SlotDef> = {};
  for (const [k, def] of Object.entries(core)) out[k] = { ...def, candidates: [...def.candidates] };
  for (const [slot, c] of Object.entries(contributed)) {
    const def = out[slot];
    if (!def) throw new Error(`extensions: no slot "${slot}" is declared by the shell (declared: ${Object.keys(core).join(', ')})`);
    for (const t of c.types) if (!def.candidates.includes(t)) def.candidates.push(t);
    if (c.default !== undefined) {
      if (def.default) throw new Error(`extensions: the slot "${slot}" already has core's default "${def.default}"`);
      def.default = c.default;
    }
  }
  return out;
}

export const SLOTS: Record<string, SlotDef> = withSlotCandidates(CORE_SLOTS, CONTRIBUTIONS.slotCandidates);

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
  // A lazy extension's type is known before its code is: its contract cannot be checked yet,
  // and a slot never waits for a download, so it falls back like any other unfit candidate.
  if (registry.pending([type]).length > 0) return 'is a lazy extension\'s node, not loaded';
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
export const MERGE_TARGET = { node: TRUNK.merge, pools: synthMergePools(CONTRIBUTIONS.pools.merge) } as const;

/** Where declared chord producers go (#600 S4): the selector the face branches share, sized like
 *  the registry's (`src/nodes/browser.ts`), feeding the overlay's chord display. */
export const CHORD_TARGET: ChordTarget = {
  node: 'chordSel',
  type: 'chord-select',
  params: {},
  pool: chordPool(CONTRIBUTIONS.pools.chords),
  outputs: [{ port: 'chord', to: { node: TRUNK.overlay, port: 'chord' } }],
};

/** Where declared category readers go (#600 S10b): the overlay's two pools, sized like the
 *  registry's overlay, for the generic category cues. */
export const CATEGORY_TARGET: CategoryTarget = {
  node: TRUNK.overlay,
  pools: { classifier: categoryPool('classifier', CONTRIBUTIONS.pools.categories.classifier), categorizer: categoryPool('categorizer', CONTRIBUTIONS.pools.categories.categorizer) },
  captions: captionsPort,
};

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
  const composed = composeGraph(ids, ALL_BRANCHES, { slots: resolveSlots(selection, registry), merge: MERGE_TARGET, chords: CHORD_TARGET, categories: CATEGORY_TARGET });
  // A contributed overlay element's config dial reaches it from the host, never a branch (#600 S5).
  const config = overlayConfigEdges({ elements: composed.elements, edges: composed.spec.edges }, CONTRIBUTIONS.overlayElements, { ui: TRUNK.ui, overlay: TRUNK.overlay });
  return config.length ? { ...composed, spec: { ...composed.spec, edges: [...composed.spec.edges, ...config] } } : composed;
}

/** The full graph: every branch. The selection swaps node types inside it (see SLOTS). */
export function defaultGraph(selection?: SlotSelection, registry?: NodeRegistry): GraphSpec {
  return composeInstrumentGraph(ALL_BRANCH_IDS, selection, registry).spec;
}
