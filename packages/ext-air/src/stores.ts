/**
 * What the air extension keeps in the browser (#600 S12): its three named collections, each under
 * the key it has always used. Declared in the manifest (`Extension.stores`), so the host lists them
 * in its storage-key registry; the collections reach their provider through the storage seam (the
 * named-collection default), never by building one.
 */
import type { StoreDecl } from '@thoremin/sdk/instruments/extension';

export const AIR_STORES = {
  padLayouts: { name: 'pad-layouts', kind: 'collection', legacyKey: 'thoremin-pad-layouts', description: 'saved drum-pad layouts' },
  patternModels: { name: 'drum-pattern-models', kind: 'collection', legacyKey: 'thoremin-drum-pattern-models', description: 'trained drum patterns' },
  vocabularies: { name: 'vocabularies', kind: 'collection', legacyKey: 'thoremin-air-vocabularies', description: 'enrolled guitar shapes and flute fingerings' },
} as const satisfies Record<string, StoreDecl>;
