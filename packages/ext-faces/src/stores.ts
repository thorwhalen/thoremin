/**
 * What the faces extension keeps in the browser (#600 S12), each under the key it has always used:
 * the holds' stills (an IndexedDB database), and the orphan sweep's flag and memory (two raw
 * localStorage values). Declared in the manifest (`Extension.stores`), so the host lists them in
 * its storage-key registry. Its categorizers are the SDK's (`@thoremin/sdk-ui/enroll/categorizers`).
 */
import type { StoreDecl } from '@thoremin/sdk/instruments/extension';

export const FACES_STORES = {
  stills: { name: 'stills', kind: 'database', legacyKey: 'thoremin-faces', description: 'hold stills' },
  sweepFlag: { name: 'stills-sweep', kind: 'item', legacyKey: 'thoremin.stills.sweep', description: 'sweep mode' },
  orphansSeen: { name: 'stills-orphans-seen', kind: 'item', legacyKey: 'thoremin.stills.orphansSeen', description: 'sweep memory' },
} as const satisfies Record<string, StoreDecl>;
