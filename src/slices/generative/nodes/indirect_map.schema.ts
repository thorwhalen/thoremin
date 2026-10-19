/**
 * The `indirect_map` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */
import { z } from 'zod';

/** The vocabularies a steering entry is built from — exported so an editor and the
 *  `steer.*` commands offer exactly what the node reads, never a second list. */
export const STEER_SOURCES = ['hand', 'face'] as const;
export const STEER_HANDS = ['left', 'right'] as const;
export const STEER_HAND_FEATURES = ['x', 'y', 'openness', 'pinch'] as const;
export const STEER_FACE_FEATURES = ['smile', 'mouthOpen', 'browRaise', 'browFurrow', 'eyeBlink'] as const;
export const STEER_FEATURES = [...STEER_HAND_FEATURES, ...STEER_FACE_FEATURES] as const;
/** The engine config knobs a dial may drive (the names `GenerativeConfig` carries). */
export const STEER_DIAL_NAMES = ['density', 'brightness', 'bpm', 'guidance', 'temperature'] as const;

export const FeatureRef = z.object({
  /** Which input to read from: a hand feature or a face expression control. */
  source: z.enum(STEER_SOURCES).default('hand'),
  /** For source='hand': which hand. */
  hand: z.enum(STEER_HANDS).default('right'),
  /**
   * Feature name. hand: x | y | openness | pinch. face: smile | mouthOpen |
   * browRaise | browFurrow | eyeBlink.
   */
  feature: z.enum(STEER_FEATURES).default('openness'),
  inMin: z.number().default(0),
  inMax: z.number().default(1),
});

export const SteerStrainSchema = FeatureRef.extend({
  /** The prompt the engine hears — and the strain's identity (trimmed, never empty). */
  text: z.string().trim().min(1),
  weightMin: z.number().default(0),
  weightMax: z.number().default(2),
});

export const SteerDialSchema = FeatureRef.extend({
  /** The engine knob this drives — one of the `GenerativeConfig` fields. */
  name: z.enum(STEER_DIAL_NAMES),
  outMin: z.number().default(0),
  outMax: z.number().default(1),
});

/**
 * The live-overridable half of {@link Params} — everything that says *what the
 * gestures mean*. Every field is optional and overrides the build-time param of
 * the same name; an omitted field keeps the param. This is the shape a store
 * slice, a dial schema and a vibe editor all speak (#141).
 *
 * Exported because it is a contract between this node and whatever drives it,
 * not an implementation detail: the same schema validates the store value, the
 * persisted dial and the value arriving on the port.
 */
export const SteerConfigSchema = z.object({
  strains: z.array(SteerStrainSchema).optional(),
  dials: z.array(SteerDialSchema).optional(),
  smoothing: z.number().min(0).max(0.999).optional(),
  throttleSec: z.number().min(0).optional(),
});
export type SteerConfig = z.infer<typeof SteerConfigSchema>;
export type SteerStrain = z.infer<typeof SteerStrainSchema>;
export type SteerDial = z.infer<typeof SteerDialSchema>;

/**
 * The default steering CONFIG — what the gestures mean until the player edits it:
 * the right hand's openness fades a pad in, raising the left hand brings in an
 * arpeggio, raising the right hand brightens the mix. The hand `y` feature is in IMAGE
 * coordinates (0 at the top), so "raise = more" is the inverted `inMin: 1, inMax: 0`,
 * exactly as `voice-mapping` inverts it for gain. COMPLETE (strains, dials, smoothing,
 * cadence) rather than partial, so the structured dial always fully specifies the
 * steering — the editor and the `steer.*` commands read and write one whole object,
 * and the scalar leaves resolve for `dial.setIn`. The generative branch
 * (`src/instruments/branches.ts`) hands the same object to `indirect-map` as its build-time params, so an unset dial and the default agree.
 */
export const DEFAULT_STEER_CONFIG: SteerConfig = {
  strains: [
    { text: 'warm ambient pads', source: 'hand', hand: 'right', feature: 'openness', inMin: 0, inMax: 1, weightMin: 0, weightMax: 2 },
    { text: 'bright plucked arpeggios', source: 'hand', hand: 'left', feature: 'y', inMin: 1, inMax: 0, weightMin: 0, weightMax: 2 },
  ],
  dials: [{ name: 'brightness', source: 'hand', hand: 'right', feature: 'y', inMin: 1, inMax: 0, outMin: 0.2, outMax: 0.9 }],
  smoothing: 0.6,
  throttleSec: 0.2,
};

/** A fresh, unshared copy of {@link DEFAULT_STEER_CONFIG} (its arrays must never be
 *  aliased between the defaults, the store and an instrument). */
export const defaultSteerConfig = (): SteerConfig => structuredClone(DEFAULT_STEER_CONFIG);
