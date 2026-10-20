/**
 * The Lab slice's stored data (#600 S12, S16b): its saved views, a named collection under the key it
 * always had, reached through the SDK's storage seam.
 */
import type { StoreDecl } from '@thoremin/sdk/instruments/extension';

export const LAB_STORES = {
  views: { name: 'views', kind: 'collection', legacyKey: 'thoremin-lab-views', description: 'the Feature Lab\'s saved views' },
} as const satisfies Record<string, StoreDecl>;
