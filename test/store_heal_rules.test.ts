/**
 * The shape of the store's rehydrate healing (#392 item 2): `mergeControls` heals the
 * whole-object fields through a rule table, so deleting a rule would silently stop healing
 * that field (an older or corrupt blob would then bind a control to undefined). These tests
 * pin the table's field set, and that no extension dial shares a name with a field the merge
 * sets itself (the extension rules are spread after the core ones, so a shared name would
 * change which heal wins). Plus the migration chain's run condition for a non-integer
 * version, which must match the original `version < n` chain.
 */
import { describe, it, expect } from 'vitest';
import { HEAL_RULES, migrateControls } from '@/app/store';
import { EXTENSION_DIAL_SCHEMAS } from '@/settings/schema';

const CORE_HEALED = [
  'overlay',
  'trainerHud',
  'faceChord',
  'faceExpr',
  'handMap',
  'hands',
  'faceControls',
  'gestures',
  'audioPrefs',
];

/** The fields mergeControls sets outside the table (after it, so they win). */
// `midi` left this list with its slice (#600 S13): an extension dial now, healed by its slice.
// `steer` / `steerPlaying` left with the generative slice (#600 S14): its dial and transient.
// `songPrefs` and the song's transients left with the song slice (#600 S15): its pref and transients.
// `conductor`, `conductorPrefs` and `scoreDoc` left with the conductor slice (#600 S18b): its dial, pref and transient.
const MERGE_EXPLICIT = ['faceMapping'];

describe('the heal table', () => {
  it('heals exactly the nine core whole-object fields (the generative `steer` is its slice\'s since #600 S14, the song\'s `songPrefs` since S15, the Lab's `featureLab` since S16b, `body` and `bodyMap` the body slice\'s since S17b, `conductor` and `conductorPrefs` the conductor slice\'s since S18b)', () => {
    expect(Object.keys(HEAL_RULES).sort()).toEqual([...CORE_HEALED].sort());
  });

  it('shares no field name with the extension dials', () => {
    const core = new Set([...Object.keys(HEAL_RULES), ...MERGE_EXPLICIT]);
    expect(Object.keys(EXTENSION_DIAL_SCHEMAS).filter((k) => core.has(k))).toEqual([]);
  });
});

describe('migrateControls on a non-integer version', () => {
  it('runs a step for every version the original `version < n` chain did', () => {
    // 1.5 < 2: the v2 step (faceEnabled -> faceMapping) runs.
    const a = migrateControls({ faceEnabled: true }, 1.5) as unknown as Record<string, unknown>;
    expect(a.faceEnabled).toBeUndefined();
    expect(a.faceMapping).toBeDefined();
    // 2.5 is not < 2, so that step does not run; 2.5 < 3, so the v3 rename does.
    const b = migrateControls({ faceEnabled: true, right: { instrument: 'bell' } }, 2.5) as unknown as Record<string, unknown>;
    expect(b.faceEnabled).toBe(true);
    expect(b.right).toEqual({ sound: 'bell' });
  });
});
