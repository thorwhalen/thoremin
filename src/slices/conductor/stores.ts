/**
 * What the conductor slice keeps in the browser (#600 S12; its own since S18b): the scores a player
 * saved to conduct. The key is the one core used, so no stored score moves.
 */
import type { StoreDecl } from '@thoremin/sdk/instruments/extension';

export const CONDUCTOR_STORES = {
  scores: { name: 'scores', kind: 'collection', legacyKey: 'thoremin-scores', description: 'the scores the conductor plays' },
} as const satisfies Record<string, StoreDecl>;
