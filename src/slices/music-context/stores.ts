/**
 * What the musical-context slice keeps in the browser: the timelines it made, by the content they
 * were made from (an IndexedDB database), so a piece's timeline is made once per device.
 */
import type { StoreDecl } from '@thoremin/sdk/instruments/extension';

export const MUSIC_CONTEXT_STORES = {
  contexts: { name: 'contexts', kind: 'database', legacyKey: 'thoremin.musicContext', description: 'the musical timelines made on this device, by content key' },
} as const satisfies Record<string, StoreDecl>;
