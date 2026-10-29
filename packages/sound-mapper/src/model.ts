/**
 * From a sound map to what the audio thread is configured with (pure): the models trained on the
 * taught taps (by class id, so two classes may share a name), the mapping from class to kit
 * sample, and the samples a context at `sampleRate` needs.
 */
import { trainMapperModels, type MapperModels, type SoundSnippet } from '@thoremin/sdk/audio/examples';
import { SOUND_MAPPER_DEFAULTS } from '@thoremin/sdk/audio/mapper';
import type { KitSound } from '@thoremin/sdk/audio/kit';
import type { SoundMap } from './schema';
import { decodePcm16 } from './pcm';

/** The sample id a kit sound is registered under in the worklet. */
export const kitSampleId = (sound: KitSound): string => `kit:${sound}`;

export function snippetsOf(map: SoundMap): SoundSnippet[] {
  return map.classes.flatMap((c) => c.examples.map((e) => ({ label: c.id, sampleRate: e.sampleRate, onset: e.onset, pcm: decodePcm16(e.pcm) })));
}

/** The classes a model can be trained on: at least one taught tap each. */
export const taughtClasses = (map: SoundMap) => map.classes.filter((c) => c.examples.length > 0);

export interface MapperConfig {
  models: MapperModels | null;
  mapping: Record<string, string>;
  sounds: KitSound[];
}

export function mapperConfig(map: SoundMap, sampleRate: number): MapperConfig {
  const taught = taughtClasses(map);
  const models =
    taught.length > 0
      ? trainMapperModels(snippetsOf(map), { sampleRate, windowMs: map.windowMs, refineMs: map.refineMs, preRoll: SOUND_MAPPER_DEFAULTS.preRoll, subtractTail: SOUND_MAPPER_DEFAULTS.subtractTail })
      : null;
  return {
    models,
    mapping: Object.fromEntries(taught.map((c) => [c.id, kitSampleId(c.sound)])),
    sounds: [...new Set(map.classes.map((c) => c.sound))],
  };
}
