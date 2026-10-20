/**
 * The probe extension (#600 S1): a test-only extension that uses EVERY contribution point the
 * extension contract offers, so a test proves that an extension from OUTSIDE the shipped list
 * reaches each of them (`test/ext_probe.test.tsx`), and a build that lists only the probes
 * carries them and nothing of the shipped extensions (`scripts/check_core_bundle.ts`).
 *
 * Two manifests, because an extension is either eager or lazy: this one is EAGER (a node, a
 * branch with a voice, a chord producer and an overlay element, a class and a catalog row, a
 * versioned dial slice with a migration, a device pref, a transient port, a seed instrument, a training route, a command,
 * a carve modality, a declared store, a derived store-controls port from a dial and from a pref,
 * a tool's need and a branch that joins the trunk);
 * `./lazy_stub.ts` is the LAZY one (a node type declared now and loaded on first use).
 *
 * The rule for later steps (`docs/design/vertical-slices.md` §5, S1): every new contribution
 * point is added to the probe FIRST, so it is tested from outside before core relies on it.
 *
 * It imports only what an extension may: the SDK packages and the schema library.
 */
import { z } from 'zod';
import { defineNode, type NodeDef } from '@thoremin/dag';
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { defineExtension, dialSlice, overlayElementId, overlayPortName, transientPort, type OverlayElementImpl } from '@thoremin/sdk/instruments/extension';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import type { CategoryScores, SynthParams } from '@thoremin/sdk/nodes/domain';
import { faceModality } from '@thoremin/sdk/features/modalities/face';

export const PROBE_NODE_TYPE = 'probe-tone';
export const PROBE_NODE_ID = 'probe';
export const PROBE_BRANCH_ID = 'probe-branch';
export const PROBE_TOOL_ID = 'probe-tool';
/** A probe tool that draws its own frame and hushes the instrument while open (#600 S16d). */
export const PROBE_OWN_FRAME_TOOL_ID = 'probe-own-frame';
export const PROBE_OWN_FRAME_HUSH = 'while the probe frames itself';
export const PROBE_INSTRUMENT = 'Probe Instrument';
/** The voice id the probe plays on: far from the trunk's 0 and 1 and the air instruments'. */
export const PROBE_VOICE_ID = 9001;
/** The probe's command (#600 S11): declared here, implemented in its React half. */
export const PROBE_COMMAND_ID = 'probe.ping';
/** The probe's carve modality (#600 S11): the face's, under its own id. */
export const PROBE_MODALITY_ID = 'probe-part';
/** The probe's store (#600 S12): a named collection under its own key, reached through the seam. */
export const PROBE_STORE = { name: 'notes', kind: 'collection', legacyKey: 'thoremin.probe.notes', description: 'the probe\'s notes (test-only)' } as const;

export const ProbeDialSchema = z.object({ enabled: z.boolean(), freq: z.number().positive() });
export type ProbeDial = z.infer<typeof ProbeDialSchema>;
export const DEFAULT_PROBE: ProbeDial = { enabled: false, freq: 440 };

/** The probe's classifier reading (#600 S10b): one class while it sounds, with a caption. */
export const PROBE_LABELS = ['P', 'Q'];
export const PROBE_CAPTIONS = ['probe P', 'probe Q'];

/** The chord tones the probe contributes to the chord display while it sounds. */
export const PROBE_CHORD = [61, 65, 68];

/** The probe's device pref: how loud it is on this device. */
export const ProbePrefSchema = z.object({ volume: z.number().min(0).max(1) });

/** How many times the probe's v1 -> v2 migration ran (a test checks it runs exactly once). */
export const probeMigrations = { runs: 0 };

/** v1 stored the frequency as `hz`; v2 calls it `freq`. Returns a new value. */
export function migrateProbeV1(old: unknown): unknown {
  probeMigrations.runs += 1;
  if (!old || typeof old !== 'object') return old;
  const { hz, ...rest } = old as Record<string, unknown>;
  return hz === undefined ? rest : { ...rest, freq: hz };
}

/** What the probe's `toolDerive` last saw composed before it (#600 S15). */
export const probeToolNeeds: { composed: readonly string[] | null } = { composed: null };

/** What the transient port carries (set by the host's hot store, off the tick). */
export interface ProbeModel {
  gain: number;
}

/** One voice at the dial's frequency, at the transient model's gain (silent without one). */
export const probeNode = defineNode<Record<string, never>>({
  type: PROBE_NODE_TYPE,
  roles: ['mapping'],
  title: 'Probe tone',
  description: 'A test-only voice: proves an outside extension reaches the graph, the settings and the hot store.',
  inputs: [
    { name: 'cfg', kind: 'probe-config' },
    { name: 'model', kind: 'probe-model' },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    { name: 'level', kind: 'number' },
    { name: 'chord', kind: 'number[]' },
    { name: 'reading', kind: 'category-scores' },
    { name: 'captions', kind: 'string[]' },
  ],
  params: z.object({}),
  process(inputs) {
    const cfg = (inputs.cfg as ProbeDial | undefined) ?? DEFAULT_PROBE;
    const gain = (inputs.model as ProbeModel | null | undefined)?.gain ?? 0;
    const params: SynthParams = { voices: [{ id: PROBE_VOICE_ID, present: gain > 0, freq: cfg.freq, gain, sound: 'sine' }] };
    // A chord the overlay's chord display shows while the probe sounds (#600 S4: a chord producer).
    // A classifier's reading the category cues draw (#600 S10b: a category reader), captioned.
    const reading: CategoryScores = { present: gain > 0, label: gain > 0 ? PROBE_LABELS[0] : null, labels: PROBE_LABELS, scores: [gain, 0] };
    return { params, level: gain, chord: gain > 0 ? PROBE_CHORD : [], reading, captions: PROBE_CAPTIONS };
  },
});

/** The probe's overlay element (#600 S5): a bar as long as the probe's level, while its dial is on. */
export const PROBE_ELEMENT = 'meter';
export const PROBE_ELEMENT_ID = overlayElementId('probe', PROBE_ELEMENT);
/** How many times the host ran the meter's per-tick update (#600 S16b), for the test. */
export const probeOverlay = { updates: 0 };
export const probeMeter: OverlayElementImpl = {
  name: PROBE_ELEMENT,
  // Once per tick before any pass draws (#600 S16b): a running count it then draws from `memo`.
  update(_frame, _inputs, memo) {
    probeOverlay.updates += 1;
    memo.ticks = ((memo.ticks as number | undefined) ?? 0) + 1;
  },
  draw(g, frame, inputs) {
    if ((inputs.config as ProbeDial | undefined)?.enabled !== true) return;
    const level = typeof inputs.level === 'number' ? inputs.level : 0;
    g.fillStyle = '#a855f7';
    g.fillRect(16, frame.H - 24, level * frame.W, 8);
  },
};

/** A candidate for the shell's `body` slot (#600 S17): a camera-free source that emits nothing. */
export const PROBE_BODY_TYPE = 'probe-body';
export const probeBodyNode = defineNode({
  type: PROBE_BODY_TYPE,
  roles: ['source'],
  title: 'Probe body',
  description: 'A test-only body source that sees nobody.',
  inputs: [],
  outputs: [{ name: 'body', kind: 'body-frame' }],
  params: z.object({}),
  process: () => ({ body: undefined }),
});

/** A branch a live claim implies by the feature groups it declares (#600 S17): no dial turns it on. */
export const PROBE_SENSE_BRANCH_ID = 'probe-sense';
export const PROBE_SENSE_GROUP = 'probe.sense';
export const PROBE_SENSE_BRANCH = defineBranch({
  id: PROBE_SENSE_BRANCH_ID,
  description: 'Test-only: composed while something claims the probe\'s feature group.',
  nodes: [],
  edges: [],
  demands: [PROBE_SENSE_GROUP],
});
/** The probe's hush (#600 S18a): its id and the badge's reason. */
export const PROBE_HUSH_ID = 'probe-hush';
export const PROBE_HUSH_REASON = 'while the probe listens';
/** What the probe's `derive` was last told is implied (a test reads it). */
export const probeDeriveSaw: { implied: string[] } = { implied: [] };

export const PROBE_BRANCH = defineBranch({
  id: PROBE_BRANCH_ID,
  description: 'The probe voice (test-only).',
  nodes: [{ id: PROBE_NODE_ID, type: PROBE_NODE_TYPE }],
  edges: [
    { from: { node: TRUNK.ui, port: 'probe' }, to: { node: PROBE_NODE_ID, port: 'cfg' } },
    { from: { node: TRUNK.ui, port: 'probeModel' }, to: { node: PROBE_NODE_ID, port: 'model' } },
    // Its overlay element's input, on the port the overlay grew for it (its config dial, `probe`,
    // is delivered by the host: no branch writes that edge).
    { from: { node: PROBE_NODE_ID, port: 'level' }, to: { node: TRUNK.overlay, port: overlayPortName('probe', PROBE_ELEMENT, 'level') } },
  ],
  overlay: [PROBE_ELEMENT_ID],
  voices: [{ from: { node: PROBE_NODE_ID, port: 'params' }, role: 'instrument' }],
  // Below the face's chords (30, 20): shown when neither sounds.
  chords: [{ from: { node: PROBE_NODE_ID, port: 'chord' }, priority: 5 }],
  // A classifier on the category cues, and its classes' captions (#600 S10b).
  categories: [{ from: { node: PROBE_NODE_ID, port: 'reading' }, kind: 'classifier', priority: 5 }],
  categoryCaptions: [{ from: { node: PROBE_NODE_ID, port: 'captions' }, for: { node: PROBE_NODE_ID, port: 'reading' } }],
});

/** A branch that joins the trunk (#600 S15): composed into every instrument, never derived or listed. */
export const PROBE_TRUNK_BRANCH_ID = 'probe-trunk';
export const PROBE_TRUNK_NODE_ID = 'probeTrunk';
export const PROBE_TRUNK_BRANCH = defineBranch({
  id: PROBE_TRUNK_BRANCH_ID,
  description: 'An idle probe node every instrument carries (test-only).',
  nodes: [{ id: PROBE_TRUNK_NODE_ID, type: PROBE_NODE_TYPE }],
  edges: [],
});

export const PROBE_EXTENSION = defineExtension({
  id: 'probe',
  nodes: [probeNode as unknown as NodeDef<unknown>, probeBodyNode as unknown as NodeDef<unknown>],
  branches: [PROBE_BRANCH, PROBE_SENSE_BRANCH, PROBE_TRUNK_BRANCH],
  trunk: [PROBE_TRUNK_BRANCH_ID],
  slotCandidates: [{ slot: 'body', types: [PROBE_BODY_TYPE] }],
  // It hushes the instrument's own voices while a probe model with no gain is in hand, and reads
  // two hands while its frequency is past 1 kHz (#600 S18a): two test-only switches.
  hushes: [{ id: PROBE_HUSH_ID, reason: PROBE_HUSH_REASON, while: (s) => (s.probeModel as ProbeModel | null | undefined)?.gain === 0 }],
  readsTwoHands: (s) => ((s.probe as Partial<ProbeDial> | undefined)?.freq ?? 0) > 1000,
  dials: [
    dialSlice({
      key: 'probe',
      schema: ProbeDialSchema.default(DEFAULT_PROBE),
      kind: 'probe-config',
      meta: { facets: ['Probe'], title: 'Probe', description: 'The probe voice (test-only)' },
      // Version 2 renamed the stored `hz` to `freq` (#600 S9): its own migration, no core edit.
      version: 2,
      migrations: { 1: migrateProbeV1 },
      // An expand step's adoption (#600 S9): a value an older build kept under `probeOld`.
      legacyKeys: ['probeOld'],
      // A store-controls port derived from the dial (#600 S13), beside the whole-dial port.
      ports: [{ name: 'probeFreq', kind: 'number', read: (d: ProbeDial) => d.freq }],
    }),
  ] as const,
  // A per-device pref (#600 S9): persisted, never saved in an instrument.
  // Its derived store-controls port (#600 S15), read from the pref or its default.
  prefs: [{ key: 'probePref', schema: ProbePrefSchema.default({ volume: 0.5 }), ports: [{ name: 'probeVolume', kind: 'number', read: (p: { volume: number }) => p.volume }] }],
  transient: [transientPort<ProbeModel>()('probeModel', 'probe-model')] as const,
  // A class of its own and a catalog row under it (#600 S8): the Instruments view lists the probe
  // instrument there, with its emoji as a system tag.
  classes: [{ id: 'probe-class', label: 'Probe instruments', emoji: '🧪', colour: 'hsl(300 50% 50%)' }],
  catalog: [{ id: 'probe', label: 'Probe', emoji: '🧪', class: 'probe-class', usesScale: true, on: (s) => (s.probe as Partial<ProbeDial> | undefined)?.enabled === true }],
  overlay: [{ name: PROBE_ELEMENT, category: 'output', inputs: [{ name: 'level', kind: 'number' }], config: { dialKey: 'probe' } }],
  overlayElements: [probeMeter],
  commandDecls: [{ id: PROBE_COMMAND_ID, title: 'Probe: ping', description: 'A test-only command.', category: 'Probe', params: z.object({ times: z.number().int().positive().default(1) }) }],
  modalities: [{ ...faceModality, id: PROBE_MODALITY_ID }],
  stores: [PROBE_STORE],
  instruments: [{ name: PROBE_INSTRUMENT, patch: { probe: { enabled: true, freq: 330 } } }],
  training: {
    routes: [{ id: 'probe', label: 'Train the probe', hint: 'Test-only.', tool: PROBE_TOOL_ID }],
    byBranch: [[PROBE_BRANCH_ID, 'probe']],
  },
  derive: (s, context) => {
    probeDeriveSaw.implied = [...(context?.implied ?? [])].sort();
    return (s as { probe?: Partial<ProbeDial> }).probe?.enabled === true ? [PROBE_BRANCH_ID] : [];
  },
  // A tool's need (#600 S15): a probe model in hand composes the probe's branch even into an
  // explicit set that leaves it out. It records what was composed before it, for the test.
  toolDerive: (s, { composed }) => {
    probeToolNeeds.composed = composed;
    return ((s as { probeModel?: ProbeModel | null }).probeModel?.gain ?? 0) > 0 ? [PROBE_BRANCH_ID] : [];
  },
});

export default PROBE_EXTENSION;
