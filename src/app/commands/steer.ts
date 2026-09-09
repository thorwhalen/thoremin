/**
 * Steering commands (#141 / #188 PR 5) — edit WHAT THE GESTURES MEAN to the
 * generative engine as `acture` commands with scalar parameters.
 *
 * `steerConfig` is a structured dial whose payload is two ARRAYS (strains, dials).
 * The generic verbs cannot reach inside an array (`dial.setIn` derives leaves for
 * objects and records only), and a command parameter must stay scalar (an object
 * param emits a JSON Schema Gemini rejects). So the editor's operations are modelled
 * as commands over one named entry each — add / remove / rename / bind / range a
 * strain, set / remove a dial — every one of which computes the next whole config
 * and writes it through {@link applyDialSet}, the same validated path `dial.setIn`
 * uses. The palette, the AI assistant and the panel therefore all speak the same
 * verbs: "add a strain called warm pads driven by my left hand's openness" is a
 * real assistant capability rather than a JSON blob.
 *
 * Strains are addressed by their TEXT (the prompt is the identity: it is what the
 * engine hears and what `indirect-map` keys its smoothing on, so renaming a strain
 * deliberately makes it ease in from rest). Dials are addressed by their NAME (the
 * engine knob they drive), one per knob.
 *
 * Handlers reach state ONLY through `applyDialSet` (writes) and the dials store's
 * `effective` view (reads), so the import firewall holds.
 */
import { z } from 'zod';
import { defineCommand, ok, err, type Result } from 'acture';
import { dialsStore } from '@/app/dials/settingsStore';
import {
  SteerConfigSchema,
  STEER_SOURCES,
  STEER_HANDS,
  STEER_FEATURES,
  STEER_HAND_FEATURES,
  STEER_DIAL_NAMES,
  defaultSteerConfig,
  type SteerConfig,
  type SteerStrain,
  type SteerDial,
} from '@/settings/schema';
import { applyDialSet } from './dials';

const DIAL_KEY = 'steerConfig';
const CATEGORY = 'Generative';

/** A complete steering config: the current dial value, healed against the default so
 *  every array is present and every entry is fully specified. */
export function currentSteerConfig(): Required<SteerConfig> {
  const raw = dialsStore.getState().effective[DIAL_KEY];
  const parsed = SteerConfigSchema.safeParse(raw);
  const base = defaultSteerConfig() as Required<SteerConfig>;
  const cfg = parsed.success ? parsed.data : {};
  return {
    strains: cfg.strains ?? base.strains,
    dials: cfg.dials ?? base.dials,
    smoothing: cfg.smoothing ?? base.smoothing,
    throttleSec: cfg.throttleSec ?? base.throttleSec,
  };
}

/** Write a whole config through the validated dial path. */
function write(next: SteerConfig): Result<{ key: string; value: unknown }> {
  return applyDialSet(DIAL_KEY, next);
}

/** The feature set that makes sense for a source: hand features for a hand, face
 *  features for a face. A mismatch is refused rather than silently reading zero. */
function featureFits(source: SteerStrain['source'], feature: SteerStrain['feature']): boolean {
  const isHand = (STEER_HAND_FEATURES as readonly string[]).includes(feature);
  return source === 'hand' ? isHand : !isHand;
}

const Source = z.enum(STEER_SOURCES);
const Hand = z.enum(STEER_HANDS);
const Feature = z.enum(STEER_FEATURES);
const DialName = z.enum(STEER_DIAL_NAMES);
const Text = z.string().trim().min(1).describe('The strain text (the prompt the engine hears); its identity.');

/** Resolve a feature binding from optional scalar args over an existing entry. */
function bindingOf(
  base: Pick<SteerStrain, 'source' | 'hand' | 'feature' | 'inMin' | 'inMax'>,
  args: { source?: SteerStrain['source']; hand?: SteerStrain['hand']; feature?: SteerStrain['feature']; invert?: boolean },
): Result<Pick<SteerStrain, 'source' | 'hand' | 'feature' | 'inMin' | 'inMax'>> {
  const source = args.source ?? base.source;
  const feature = args.feature ?? base.feature;
  if (!featureFits(source, feature)) {
    return err('feature_source_mismatch', `"${feature}" is not a ${source} feature.`, { source, feature });
  }
  const invert = args.invert ?? base.inMin > base.inMax;
  return ok({ source, hand: args.hand ?? base.hand, feature, inMin: invert ? 1 : 0, inMax: invert ? 0 : 1 });
}

const DEFAULT_STRAIN_BINDING = { source: 'hand', hand: 'right', feature: 'openness', inMin: 0, inMax: 1 } as const;

export const addStrainCmd = defineCommand({
  id: 'steer.strain.add',
  title: 'Add a strain',
  description: 'Add a text prompt the generative engine blends in, driven by a hand or face feature.',
  category: CATEGORY,
  params: z.object({
    text: Text,
    source: Source.optional().describe('hand (default) or face.'),
    hand: Hand.optional().describe('For a hand source: left or right (default right).'),
    feature: Feature.optional().describe('hand: x | y | openness (default) | pinch; face: smile | mouthOpen | browRaise | browFurrow | eyeBlink.'),
    invert: z.boolean().optional().describe('Read the feature upside down (e.g. raising the hand = more).'),
    weightMax: z.number().min(0).max(4).optional().describe('The weight at full feature (default 2).'),
  }),
  execute: ({ text, weightMax, ...binding }) => {
    const cfg = currentSteerConfig();
    if (cfg.strains.some((s) => s.text === text)) return err('duplicate_strain', `A strain "${text}" already exists.`, { text });
    const b = bindingOf(DEFAULT_STRAIN_BINDING, binding);
    if (!b.ok) return b;
    const strain: SteerStrain = { ...b.value, text, weightMin: 0, weightMax: weightMax ?? 2 };
    const r = write({ ...cfg, strains: [...cfg.strains, strain] });
    return r.ok ? ok({ text }) : r;
  },
});

export const removeStrainCmd = defineCommand({
  id: 'steer.strain.remove',
  title: 'Remove a strain',
  description: 'Remove a text prompt from the generative steering.',
  category: CATEGORY,
  params: z.object({ text: Text }),
  execute: ({ text }) => {
    const cfg = currentSteerConfig();
    if (!cfg.strains.some((s) => s.text === text)) return err('unknown_strain', `No strain "${text}".`, { text });
    const r = write({ ...cfg, strains: cfg.strains.filter((s) => s.text !== text) });
    return r.ok ? ok({ text }) : r;
  },
});

export const renameStrainCmd = defineCommand({
  id: 'steer.strain.rename',
  title: 'Rename a strain',
  description: 'Change what a strain says (it keeps its feature binding and eases in fresh).',
  category: CATEGORY,
  params: z.object({ text: Text, to: Text.describe('The new text.') }),
  execute: ({ text, to }) => {
    const cfg = currentSteerConfig();
    if (!cfg.strains.some((s) => s.text === text)) return err('unknown_strain', `No strain "${text}".`, { text });
    if (to !== text && cfg.strains.some((s) => s.text === to)) return err('duplicate_strain', `A strain "${to}" already exists.`, { text: to });
    const r = write({ ...cfg, strains: cfg.strains.map((s) => (s.text === text ? { ...s, text: to } : s)) });
    return r.ok ? ok({ text: to }) : r;
  },
});

export const bindStrainCmd = defineCommand({
  id: 'steer.strain.bind',
  title: 'Bind a strain to a feature',
  description: 'Choose which hand or face feature drives a strain, and which way up.',
  category: CATEGORY,
  params: z.object({
    text: Text,
    source: Source.optional().describe('hand or face (unchanged when omitted).'),
    hand: Hand.optional().describe('left or right (unchanged when omitted).'),
    feature: Feature.optional().describe('The feature (unchanged when omitted).'),
    invert: z.boolean().optional().describe('Read the feature upside down (unchanged when omitted).'),
  }),
  execute: ({ text, ...binding }) => {
    const cfg = currentSteerConfig();
    const cur = cfg.strains.find((s) => s.text === text);
    if (!cur) return err('unknown_strain', `No strain "${text}".`, { text });
    const b = bindingOf(cur, binding);
    if (!b.ok) return b;
    const r = write({ ...cfg, strains: cfg.strains.map((s) => (s.text === text ? { ...s, ...b.value } : s)) });
    return r.ok ? ok({ text }) : r;
  },
});

export const rangeStrainCmd = defineCommand({
  id: 'steer.strain.range',
  title: 'Set a strain’s weight range',
  description: 'The prompt weight at the feature’s minimum and maximum (0 = silent, 2 = strong).',
  category: CATEGORY,
  params: z.object({
    text: Text,
    weightMin: z.number().min(0).max(4).optional(),
    weightMax: z.number().min(0).max(4).optional(),
  }),
  execute: ({ text, weightMin, weightMax }) => {
    const cfg = currentSteerConfig();
    const cur = cfg.strains.find((s) => s.text === text);
    if (!cur) return err('unknown_strain', `No strain "${text}".`, { text });
    const next = { ...cur, weightMin: weightMin ?? cur.weightMin, weightMax: weightMax ?? cur.weightMax };
    const r = write({ ...cfg, strains: cfg.strains.map((s) => (s.text === text ? next : s)) });
    return r.ok ? ok({ text }) : r;
  },
});

/** Sensible output ranges per engine knob, used when a dial is first created. */
const DIAL_RANGES: Record<(typeof STEER_DIAL_NAMES)[number], [number, number]> = {
  density: [0, 1],
  brightness: [0, 1],
  bpm: [60, 200],
  guidance: [1, 6],
  temperature: [0.5, 2],
};

export const setDialCmd = defineCommand({
  id: 'steer.dial.set',
  title: 'Drive an engine dial from a feature',
  description: 'Bind an engine knob (density, brightness, bpm, guidance, temperature) to a hand or face feature; creates the binding if absent.',
  category: CATEGORY,
  params: z.object({
    name: DialName.describe('The engine knob.'),
    source: Source.optional(),
    hand: Hand.optional(),
    feature: Feature.optional(),
    invert: z.boolean().optional(),
    outMin: z.number().optional().describe('The knob value at the feature’s minimum.'),
    outMax: z.number().optional().describe('The knob value at the feature’s maximum.'),
  }),
  execute: ({ name, outMin, outMax, ...binding }) => {
    const cfg = currentSteerConfig();
    const cur = cfg.dials.find((d) => d.name === name);
    const [lo, hi] = DIAL_RANGES[name];
    const base = cur ?? { ...DEFAULT_STRAIN_BINDING, name, outMin: lo, outMax: hi };
    const b = bindingOf(base, binding);
    if (!b.ok) return b;
    const next: SteerDial = { ...base, ...b.value, name, outMin: outMin ?? base.outMin, outMax: outMax ?? base.outMax };
    const dials = cur ? cfg.dials.map((d) => (d.name === name ? next : d)) : [...cfg.dials, next];
    const r = write({ ...cfg, dials });
    return r.ok ? ok({ name }) : r;
  },
});

export const removeDialCmd = defineCommand({
  id: 'steer.dial.remove',
  title: 'Stop driving an engine dial',
  description: 'Remove a feature → engine-knob binding.',
  category: CATEGORY,
  params: z.object({ name: DialName }),
  execute: ({ name }) => {
    const cfg = currentSteerConfig();
    if (!cfg.dials.some((d) => d.name === name)) return err('unknown_dial', `No dial "${name}" is bound.`, { name });
    const r = write({ ...cfg, dials: cfg.dials.filter((d) => d.name !== name) });
    return r.ok ? ok({ name }) : r;
  },
});

export const STEER_COMMANDS = [addStrainCmd, removeStrainCmd, renameStrainCmd, bindStrainCmd, rangeStrainCmd, setDialCmd, removeDialCmd];
