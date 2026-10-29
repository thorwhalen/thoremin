/** The sound mapper's declared stores (#600 S12): the player's sound maps, taught taps inside. */
import type { StoreDecl } from '@thoremin/sdk/instruments/extension';

export const SOUND_MAPPER_STORES = {
  maps: { name: 'maps', kind: 'collection', legacyKey: 'thoremin.soundMapper.maps', description: 'the sound mapper\'s maps and the taps that taught them' },
} as const satisfies Record<string, StoreDecl>;
