/**
 * The generative layer's dial (#141 / #188; a slice since #600 S14): gesture features steering a
 * cloud generative engine (Lyria RealTime) through the `indirect-map → lyria` branch. "This
 * instrument has a generative layer, at this level, driven by these strains" is instrument
 * identity, like "plays over MIDI". `config` is the `indirect-map` node's own
 * {@link SteerConfigSchema}, imported rather than restated so the dial, the store and the port can
 * never disagree about the shape. The TRANSPORT (playing) is deliberately NOT here: a persisted
 * transport would ride a saved instrument and start a paid stream on load, so it is a transient
 * field (`steerPlaying`), on the `muted` precedent.
 *
 * A FLAT slice, with the keys it had before it was one: `steer.enabled`, `steer.volume`, and the
 * steering config under `steerConfig` (`flatKeys`), a structured dial whose arrays the `steer.*`
 * commands edit and whose scalar leaves (`steerConfig.smoothing`, `steerConfig.throttleSec`)
 * `dial.setIn` reaches.
 */
import { z } from 'zod';
import { SteerConfigSchema, defaultSteerConfig, type SteerConfig } from './nodes/indirect_map.schema';

export const SteerSettingsSchema = z.object({
  enabled: z.boolean().default(false).meta({ facets: ['Generative'], title: 'Generative layer', description: 'Let your gestures steer a cloud generative engine (Lyria RealTime; needs your Gemini key)' }),
  volume: z.number().min(0).max(1).default(0.7).meta({ facets: ['Generative'], title: 'Generative volume' }),
  config: SteerConfigSchema.default(() => defaultSteerConfig()).meta({
    facets: ['Generative', 'advanced'],
    title: 'Generative steering',
    description: 'Which strains (text prompts) and engine dials your hand and face features drive',
  }),
});
export type SteerSettings = z.infer<typeof SteerSettingsSchema>;

/** The shipped generative defaults: off, 0.7, the default steering config. */
export const DEFAULT_STEER: SteerSettings = { enabled: false, volume: 0.7, config: defaultSteerConfig() };

/** A PARTIAL steering config (the shape #202 persisted: smoothing + cadence, no arrays) completed
 *  from the default; itself when nothing is missing. Absent arrays already meant "the starter
 *  strains" to the node, so this is sound-identical; it exists so the working layer and a saved
 *  instrument can never differ by a key nobody edited and flag a phantom "unsaved edits". */
export function completeSteerConfig(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const dflt = defaultSteerConfig() as Required<SteerConfig>;
  const missing = (Object.keys(dflt) as (keyof SteerConfig)[]).some((k) => (value as SteerConfig)[k] === undefined);
  return missing ? { ...dflt, ...(value as SteerConfig) } : value;
}
