/**
 * The default Thoremin instrument graph — the wiring that makes hand gestures
 * play tonal audio with overlays, steerable live by keyboard + UI.
 *
 *   webcam ─┬─▶ hand-features ─┬─▶ voice-mapping ─▶ synth-merge ─▶ webaudio-synth
 *           │                  │        ▲ ▲ ▲ ▲          ▲
 *           └────────▶ overlay ◀┘        │ │ │ │         │ (+ face chord)
 *                       (video+guides)   │ │ │ └── store-controls (scale/instrument)
 *                                        │ │ └──── keyboard-control (magnetism/octave/mute)
 *                                        │ └────── keyboard-source ─▶ keyboard-control
 *   webcam-face ─┬─▶ face-features ──────┘ (timbre: smile→brightness, mouth→vibrato)
 *                └─▶ face-expression ─▶ expression-chord ─▶ synth-merge
 *                       (chord: expression → diatonic triad)
 *
 * The face branch is always wired but idle until the player picks a face mapping:
 * `webcam-face` only loads its model (and emits a present face) when `faceMapping`
 * is not `none`, so it costs nothing when off. The chord path (`expression-chord`)
 * emits silent voices unless the mode is `chord`, so the merge passes the hand
 * voices through unchanged otherwise.
 *
 * One output may fan OUT to several inputs (webcam→features & overlay); only
 * fan-IN to a single input port is disallowed.
 */
import type { GraphSpec, NodeRegistry, Role } from '@/dag';
import { MAPPING_SLOT_CONTRACT, type SlotContract } from '@/nodes/mapping/mapping_contract';

/**
 * A Slot is a named, role-typed swap point the graph builder fills from config.
 * `default` is used when no/invalid selection is given; `candidates` is the set
 * of REAL interchangeable implementations today (the SSOT for "what can fill
 * this slot" — not `registry.listByRole`, which is advisory and broader).
 *
 * Governance (docs/design/component-model.md): a slot graduates to a user-facing
 * dropdown only at >=2 candidates. The `mapping` slot has one today, so this is a
 * developer-facing seam (graphs are data): selection is honored + validated, but
 * there is no UI. Adding the second hand-features→synth-params mapping is a
 * one-line `candidates` extension that activates real swapping.
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
};

/** Per-slot chosen node types (keys ⊆ SLOTS keys); all optional → defaults used. */
export type SlotSelection = Partial<Record<keyof typeof SLOTS, string>>;

/**
 * Why a node type does NOT satisfy a slot, or `null` if it does. Checks, in order:
 * registered, carries the slot role, emits the slot's output port+kind, and
 * declares every required input port. (The engine's validateEdge only checks port
 * names, so this is the pre-flight that catches a bad swap before construction.)
 */
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
 * Resolve a slot to a concrete node type. Returns the slot default unless a valid,
 * contract-satisfying selection is given; warns and falls back on a stale/invalid
 * one (or when no registry is available to validate against).
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

/**
 * Build the default instrument graph. With no `selection` it is byte-identical to
 * before (all slots use their defaults). A `selection` (validated against
 * `registry`) swaps slot-bound node types — the edges reference only port names
 * the slot contract guarantees, so a contract-satisfying swap stays edge-stable.
 */
export function defaultGraph(selection?: SlotSelection, registry?: NodeRegistry): GraphSpec {
  const mappingType = resolveSlot('mapping', selection, registry);
  return {
    nodes: [
      { id: 'cam', type: 'webcam-hands', params: { modelType: 'full', maxHands: 2 } },
      { id: 'feat', type: 'hand-features', params: { mirrorX: true, mirrorHandedness: true } },
      // Face branch (idle until the player picks a face mapping in settings).
      { id: 'camFace', type: 'webcam-face', params: {} },
      { id: 'faceFeat', type: 'face-features', params: { smoothing: 0.3 } },
      // Chord path: classify the expression, then play its diatonic triad.
      { id: 'faceExpr', type: 'face-expression', params: {} },
      { id: 'exprChord', type: 'expression-chord', params: {} },
      { id: 'kbd', type: 'keyboard-source' },
      { id: 'kctrl', type: 'keyboard-control', params: { magnetismStart: 0.8 } },
      { id: 'ui', type: 'store-controls' },
      { id: 'map', type: mappingType, params: { magnetism: 0.8, maxGain: 0.5 } },
      // Union the hand voices with the face-chord voices before the synth.
      { id: 'merge', type: 'synth-merge', params: {} },
      { id: 'synth', type: 'webaudio-synth' },
      // Overlay elements default on (video/scaleGuide/landmarks/markers); the
      // opt-in index-finger guide is off by default. See canvas_overlay.ts.
      { id: 'overlay', type: 'canvas-overlay', params: {} },
    ],
    edges: [
      { from: { node: 'cam', port: 'hands' }, to: { node: 'feat', port: 'hands' } },
      { from: { node: 'cam', port: 'hands' }, to: { node: 'overlay', port: 'hands' } },
      // Face timbre: webcam-face → face-features → voice-mapping's optional `face`
      // input (smile adds brightness, open mouth adds vibrato). Absent face / chord
      // mode → no effect.
      { from: { node: 'camFace', port: 'face' }, to: { node: 'faceFeat', port: 'face' } },
      { from: { node: 'faceFeat', port: 'features' }, to: { node: 'map', port: 'face' } },
      // Face chord: webcam-face → face-expression → expression-chord (fed the live
      // scale spec + face mode). Emits silent voices unless mode is 'chord'.
      { from: { node: 'camFace', port: 'face' }, to: { node: 'faceExpr', port: 'face' } },
      // Live per-emotion sensitivities steer the classifier's thresholds.
      { from: { node: 'ui', port: 'expressionSensitivity' }, to: { node: 'faceExpr', port: 'sensitivity' } },
      { from: { node: 'faceExpr', port: 'expression' }, to: { node: 'exprChord', port: 'expression' } },
      { from: { node: 'ui', port: 'rightSpec' }, to: { node: 'exprChord', port: 'spec' } },
      // Live per-expression scale-degree map (which triad each expression plays).
      { from: { node: 'ui', port: 'expressionDegrees' }, to: { node: 'exprChord', port: 'degrees' } },
      { from: { node: 'ui', port: 'faceMapping' }, to: { node: 'exprChord', port: 'faceMapping' } },
      // Live chord settings (instrument / volume / voicing / rendering / tempo).
      { from: { node: 'ui', port: 'chordConfig' }, to: { node: 'exprChord', port: 'chordConfig' } },
      // Keep the face chord in the same register as the hand melody (octave shift).
      { from: { node: 'kctrl', port: 'octaveShift' }, to: { node: 'exprChord', port: 'octaveShift' } },
      { from: { node: 'feat', port: 'features' }, to: { node: 'map', port: 'features' } },
      { from: { node: 'feat', port: 'features' }, to: { node: 'overlay', port: 'features' } },
      { from: { node: 'kbd', port: 'pressed' }, to: { node: 'kctrl', port: 'pressed' } },
      { from: { node: 'kctrl', port: 'magnetism' }, to: { node: 'map', port: 'magnetism' } },
      { from: { node: 'kctrl', port: 'octaveShift' }, to: { node: 'map', port: 'octaveShift' } },
      { from: { node: 'kctrl', port: 'mute' }, to: { node: 'map', port: 'mute' } },
      { from: { node: 'ui', port: 'scaleRight' }, to: { node: 'map', port: 'scaleRight' } },
      { from: { node: 'ui', port: 'scaleLeft' }, to: { node: 'map', port: 'scaleLeft' } },
      { from: { node: 'ui', port: 'instrumentRight' }, to: { node: 'map', port: 'instrumentRight' } },
      { from: { node: 'ui', port: 'instrumentLeft' }, to: { node: 'map', port: 'instrumentLeft' } },
      // Merge the hand voices (map) with the face-chord voices, then to the synth.
      { from: { node: 'map', port: 'params' }, to: { node: 'merge', port: 'a' } },
      { from: { node: 'exprChord', port: 'params' }, to: { node: 'merge', port: 'b' } },
      { from: { node: 'merge', port: 'params' }, to: { node: 'synth', port: 'params' } },
      // Also feed the hand params to the overlay so it can label each hand's note.
      { from: { node: 'map', port: 'params' }, to: { node: 'overlay', port: 'params' } },
      // And both hands' scales + octave shift, for the overlay pitch guides.
      { from: { node: 'ui', port: 'scaleRight' }, to: { node: 'overlay', port: 'scale' } },
      { from: { node: 'ui', port: 'scaleLeft' }, to: { node: 'overlay', port: 'scaleLeft' } },
      { from: { node: 'kctrl', port: 'octaveShift' }, to: { node: 'overlay', port: 'octaveShift' } },
      // The face chord's tones, so the overlay can highlight them on the guide.
      { from: { node: 'exprChord', port: 'triad' }, to: { node: 'overlay', port: 'chord' } },
      // The raw face frame (mesh) + classified expression, for the face overlays.
      { from: { node: 'camFace', port: 'face' }, to: { node: 'overlay', port: 'faceFrame' } },
      { from: { node: 'faceExpr', port: 'expression' }, to: { node: 'overlay', port: 'expression' } },
      // Live overlay element config from the UI store (toggle elements without rebuild).
      { from: { node: 'ui', port: 'overlay' }, to: { node: 'overlay', port: 'overlayConfig' } },
    ],
  };
}
