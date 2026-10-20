/**
 * What the harmony extension keeps in the browser: the player's ratings of chord moves ("Rate this
 * move", #715). Declared in the manifest (`Extension.stores`), so the host lists it in its
 * storage-key registry; the collection reaches its provider through the storage seam (the
 * named-collection default), never by building one.
 */
import type { StoreDecl } from '@thoremin/sdk/instruments/extension';

export const HARMONY_STORES = {
  moveRatings: { name: 'move-ratings', kind: 'collection', legacyKey: 'thoremin-move-ratings', description: "the player's ratings of chord moves (dark to bright, settled to tense)" },
} as const satisfies Record<string, StoreDecl>;
