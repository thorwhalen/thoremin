/**
 * The sound mapper (lane B of #866; `docs/design/audio-input.md`, `docs/research/audio-trigger-latency.md`):
 * teach it a few struck sounds (taps on a table, a pot), give each a drum, and every tap plays its
 * drum within a few milliseconds. A TOOL, not an instrument, as the Song is: the mapped drums play
 * under whatever instrument is loaded, and nothing of it is an instrument setting.
 *
 * It has no graph of its own: what sounds runs on the audio thread, in the `sound-mapper` analyser
 * of the shared audio-input worklet, which the tool's store configures through its lease on the
 * hub (`./app/store.ts`). Its pure manifest declares only what it keeps in the browser.
 */
import { defineExtension } from '@thoremin/sdk/instruments/extension';
import { SOUND_MAPPER_STORES } from './stores';

export const SOUND_MAPPER_EXTENSION_ID = 'sound-mapper';

export const SOUND_MAPPER_EXTENSION = defineExtension({
  id: SOUND_MAPPER_EXTENSION_ID,
  nodes: [],
  branches: [],
  dials: [] as const,
  transient: [] as const,
  derive: () => [],
  stores: Object.values(SOUND_MAPPER_STORES),
});

export default SOUND_MAPPER_EXTENSION;
