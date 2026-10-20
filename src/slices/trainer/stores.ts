/**
 * The Trainer's declared stores (#600 S12, S16d): its cue and routine collections and its
 * per-device preferences, each under the key it always had.
 */
import type { StoreDecl } from '@thoremin/sdk/instruments/extension';

export const TRAINER_STORES = {
  cues: { name: 'cues', kind: 'collection', legacyKey: 'thoremin-cues', description: 'the trainer\'s cues' },
  routines: { name: 'routines', kind: 'collection', legacyKey: 'thoremin-routines', description: 'the trainer\'s routines' },
  prefs: { name: 'prefs', kind: 'item', legacyKey: 'thoremin-trainer-prefs', description: 'the trainer\'s preferences' },
} as const satisfies Record<string, StoreDecl>;
