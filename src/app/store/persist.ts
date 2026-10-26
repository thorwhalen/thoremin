/**
 * What the hot store persists and how a stored blob comes back (#600 S19b, out of `store.ts`): the
 * three groups of fields (preset dials, device prefs, the session), the written blob, the merge
 * that heals a rehydrated one, and the storage (localStorage in a browser, nothing elsewhere).
 */
import type { StateStorage } from 'zustand/middleware';
import { hostPersistValues, noopValues } from '@thoremin/sdk-ui/storage';
import { FACE_MAPPINGS, legacyFaceToMapping, type FaceMapping } from '@thoremin/sdk/nodes/domain';
import { extensionTransientDefaults } from '@/settings/schema';
import { assertNoCoreClash, CONTRIBUTIONS } from '@/host/contributions';
import type { PrefSlice } from '@thoremin/sdk/instruments/extension';
import { migrateSlices, sliceVersionsToWrite, SLICE_VERSIONS_KEY } from '@/host/slices';
import { SETTINGS_KEYS, type ControlState } from './state';
import { EXTENSION_HEAL_RULES, HEAL_RULES, healAll, type HealRule } from './heal';
import { SLICE_CHAINS } from './migrations';

/** The slices the last rehydrated blob had that no listed extension claims (an extension removed
 *  from the build), with their stored versions: carried through every write untouched. */
let foreignSlices: Readonly<Record<string, number>> = {};

/**
 * The initial state with the extensions' per-device prefs added at their schema defaults (a first
 * load). A pref named like a core field (or a dial, or a transient) would replace that field's
 * default and its heal rule, and a returning player's value would be healed through the wrong
 * schema: refused, loudly, when the store is built. Exported for direct testing.
 */
export function withExtensionPrefs<S extends object>(state: S, prefSlices: readonly PrefSlice[] = CONTRIBUTIONS.prefSlices): S {
  assertNoCoreClash('hot-store field (as a pref)', Object.keys(state), prefSlices.map((p) => p.key));
  return { ...state, ...Object.fromEntries(prefSlices.map((p) => [p.key, structuredClone(p.schema.parse(undefined))])) };
}

/**
 * The three groups of {@link ControlState} (#600 S9), declared once so what is saved is computed,
 * never hand-kept: PRESET dials (the settings schema's keys, saved in an instrument too), DEVICE
 * prefs (core's below and every extension's pref slice: persisted, never in an instrument), and
 * the SESSION (everything else: transients, the transport, the loaded song; never persisted).
 */
const CORE_DEVICE_PREF_KEYS = ['faceCalibration', 'gestures', 'audioPrefs'] as const satisfies readonly (keyof ControlState)[];
const PERSISTED_KEYS: readonly string[] = [...SETTINGS_KEYS, ...CORE_DEVICE_PREF_KEYS, ...CONTRIBUTIONS.prefSlices.map((p) => p.key)];

/** What the hot store persists: the preset dials and the device prefs, the foreign slices as they
 *  were stored, and every slice's version. Exported for direct testing. */
export function persistedControls(s: ControlState): Record<string, unknown> {
  const state = s as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of PERSISTED_KEYS) out[k] = state[k];
  for (const k of Object.keys(foreignSlices)) out[k] = state[k];
  out[SLICE_VERSIONS_KEY] = sliceVersionsToWrite(SLICE_CHAINS, foreignSlices);
  return out;
}

/**
 * Merge a rehydrated blob over the current (initializer) state. Beyond zustand's default
 * shallow merge it HEALS the whole-object fields so an older/corrupt blob can't crash newer
 * readers: each field in {@link HEAL_RULES} (and each extension dial) is re-parsed through its
 * schema, keeping the current value when absent or corrupt (a FLAT extension dial, such as
 * `midi`, field by field); and `faceMapping` is clamped to a known mode (unknown values → derived
 * from any legacy `faceEnabled`, else `none`). Exported for direct testing.
 */
export function mergeControls(persisted: unknown, current: ControlState): ControlState {
  // The extensions' slices first (#600 S9): each runs its own chain, and a slice no listed
  // extension claims is remembered, to be written back untouched.
  const migrated = migrateSlices(persisted ?? {}, SLICE_CHAINS);
  // A stored version on a core field is not a foreign slice: core's fields are written anyway.
  foreignSlices = Object.fromEntries(Object.entries(migrated.foreign).filter(([k]) => !PERSISTED_KEYS.includes(k)));
  const p = migrated.blob as Partial<ControlState> & { faceEnabled?: boolean };
  const stored = p as Record<string, unknown>;
  const cur = current as unknown as Record<string, unknown>;
  const healed = {
    ...healAll(stored, cur, HEAL_RULES as Readonly<Record<string, HealRule<unknown> | undefined>>),
    ...healAll(stored, cur, EXTENSION_HEAL_RULES),
  } as Partial<ControlState>;
  const faceMapping = (FACE_MAPPINGS as readonly string[]).includes(p.faceMapping as string)
    ? (p.faceMapping as FaceMapping)
    : legacyFaceToMapping(p.faceEnabled);
  // The transport never resumes from storage (it is not persisted; `current` wins even
  // over a hand-edited blob), so a reload can never start a paid stream by itself.
  return { ...current, ...p, ...healed, faceMapping, ...keptTransients(current) };
}

/** The extensions' transient fields as they are now: a rehydrated blob never carries them
 *  (they are not persisted), and a hand-edited one must not override them. */
function keptTransients(current: ControlState): Partial<ControlState> {
  const c = current as unknown as Record<string, unknown>;
  return Object.fromEntries(Object.keys(extensionTransientDefaults()).map((f) => [f, c[f]])) as Partial<ControlState>;
}

// The host's key-value target (the SDK's storage seam, #659: localStorage in the browser, under
// this store's key); a no-op where the host has none (Node test runtime), so the persist
// middleware never references a missing `window`/`localStorage`.
export const controlsStorage = (): StateStorage => hostPersistValues(noopValues);

