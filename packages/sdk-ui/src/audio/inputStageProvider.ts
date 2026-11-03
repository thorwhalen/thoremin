/**
 * Where this device's input-stage record persists (`./inputStage.ts`): the host's collection under
 * {@link INPUT_STAGE_STORAGE_KEY} (localStorage by default, the app's chosen target once the shell
 * installs one), or memory where the page has no storage it may read (plain Node, or a browser with
 * site data blocked, where touching `localStorage` throws).
 *
 * A module of its own so the store imports it DYNAMICALLY, from its async hydration: the host's
 * storage seam and the zodal providers are then a chunk a standalone page loads after its first
 * paint, not part of the entry every game page carries (#881 review).
 */
import { createInMemoryProvider, type DataProvider } from '@zodal/store';
import { hostCollection, localStorageValues } from '../storage';
import { INPUT_STAGE_STORAGE_KEY, type InputStageRecord } from './inputStageRecord';

export function createInputStageProvider(): DataProvider<InputStageRecord> {
  return localStorageValues() === null ? createInMemoryProvider<InputStageRecord>([], { idField: 'id' }) : hostCollection<InputStageRecord>(INPUT_STAGE_STORAGE_KEY);
}
