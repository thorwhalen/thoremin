/**
 * The `orchestra` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */
import { z } from 'zod';
import { SECTIONS, type Section } from './orchestra_map.schema';

/** The shipped soundfont's size in MB, stated on the toggle before the download (the
 *  lazy-loading rule); `test/orchestra_bank.test.ts` pins it to the committed file. */
export const SOUNDFONT_SIZE_MB = 6.0;

/**
 * The player's orchestra settings: a structured leaf of the `conductor` dial
 * (`conductor.orchestra.*`), so every field is a `dial.setIn` path for the panel, the
 * palette and the assistant. The node reads it from its `config` input.
 */
export const OrchestraSettingsSchema = z.object({
  /** Off by default: switching it on downloads the soundfont ({@link SOUNDFONT_SIZE_MB} MB, once). */
  enabled: z.boolean().default(false),
  /** The orchestra's overall level, 0..1 (CC7 with the section's own level). */
  volume: z.number().min(0).max(1).default(0.8),
  /** Strings go pizzicato on a sharp conducting stroke and back to the bow on a smooth one (#332).
   *  Off by default: it changes what is heard, and a program change mid-phrase needs ears (#146). */
  pizzicato: z.boolean().default(false),
  /** Per-section level, 0..1. */
  sections: z
    .object(Object.fromEntries(SECTIONS.map((s) => [s, z.number().min(0).max(1).default(1)])) as Record<Section, z.ZodDefault<z.ZodNumber>>)
    .default(() => Object.fromEntries(SECTIONS.map((s) => [s, 1])) as Record<Section, number>),
});
export type OrchestraSettings = z.infer<typeof OrchestraSettingsSchema>;
export const DEFAULT_ORCHESTRA: OrchestraSettings = OrchestraSettingsSchema.parse({});


/** The facade the node drives: `spessasynth_lib` in the browser, a recorder in tests.
 *  Times are `AudioContext` seconds. */
export interface OrchestraSynth {
  noteOn(channel: number, key: number, velocity: number, time: number): void;
  noteOff(channel: number, key: number, time: number): void;
  controllerChange(channel: number, cc: number, value: number, time: number): void;
  programChange(channel: number, program: number): void;
  /** Release everything now (the piece changed, the conductor stopped). */
  allNotesOff(): void;
  /** Disconnect and free the synth. */
  close(): void;
}

export interface OrchestraEngineOpts {
  audioContext?: AudioContext;
  /** Where the orchestra mixes its audio (the app's masterGain). */
  destination?: AudioNode;
  signal: AbortSignal;
  progress: (fraction: number) => void;
}
