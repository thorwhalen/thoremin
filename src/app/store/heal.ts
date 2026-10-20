/**
 * How a rehydrated blob is healed (#600 S19b, out of `store.ts`): one rule per core whole-object
 * field, and the extensions' dials and prefs each through its own slice schema, so an older or
 * corrupt blob can never leave a control bound to undefined.
 */
import { OverlayDialSchema } from '@/nodes/output/canvas_overlay.schema';
import { GesturePrefsSchema } from '../gesturePrefs';
import { DEFAULT_FACE_CHORD, DEFAULT_FACE_EXPR, DEFAULT_HANDS, EXTENSION_DIAL_SCHEMAS, HandsSettingsSchema, FaceChordSchema, FaceExprSchema, HandMapSchema, type FaceExpr } from '@/settings/schema';
import { FaceControlsDialSchema } from '@/nodes/features/face_controls.schema';
import { AudioPrefsSchema } from '../timing/audioPrefs';
import { CONTRIBUTIONS } from '@/host/contributions';
import { flatFields } from '@/host/slices';
import type { DialSlice } from '@thoremin/sdk/instruments/extension';
import type { ControlState } from './state';

/**
 * How one whole-object field of a rehydrated blob is healed: re-parsed through `schema`,
 * after `complete` (when given) builds the parse input from the stored value (filling what
 * an older blob lacks), and `finish` (when given) post-processes the parse. Typed per field,
 * so a schema whose output is not that field's type fails the typecheck.
 */
export interface HealRule<T> {
  schema: { parse(input: unknown): T };
  complete?: (stored: unknown, current: T) => unknown;
  finish?: (parsed: T) => T;
}

/**
 * Heal one stored field: a falsy stored value (absent from an older blob) keeps `current`;
 * otherwise the rule's parse, and anything that throws on the way (a corrupt blob) falls
 * back to `current` whole, so a newer reader never binds a control to undefined.
 */
function heal<T>(stored: unknown, current: T, rule: HealRule<T>): T {
  if (!stored) return current;
  try {
    const parsed = rule.schema.parse(rule.complete ? rule.complete(stored, current) : stored);
    return rule.finish ? rule.finish(parsed) : parsed;
  } catch {
    return current;
  }
}

/** Complete a partial stored object from a shipped default before the parse. Generic in the
 *  field's type, so a rule pointed at another field's default fails the typecheck. */
const overDefaults =
  <T>(defaults: T) =>
  (stored: unknown, _current: T): unknown => ({ ...defaults, ...(stored as object) });

/** Complete a partial stored object from the current (initializer) value before the parse. */
export const overCurrent = (stored: unknown, current: unknown): unknown => ({ ...(current as object), ...(stored as object) });

/**
 * The core fields {@link mergeControls} heals, one rule each. Three completions are in use
 * and they are NOT interchangeable: a raw parse (the schema's own `.default`s complete a
 * partial blob), the shipped default spread under the blob, or the current value spread
 * under it. On a real rehydrate `current` is the initializer, which equals the defaults; the
 * difference shows only when `mergeControls` is called with some other `current`, and each
 * rule keeps the completion its field has always had.
 */
type CoreHealRules = { [K in keyof ControlState]?: HealRule<ControlState[K]> };
export const HEAL_RULES: CoreHealRules = {
  // Fills defaults for overlay elements added since the blob was written (e.g. `chordGuide`
  // in #64, whose absence would otherwise throw in `overlay.chordGuide.show`).
  overlay: { schema: OverlayDialSchema },
  // Completed from the defaults, then validated, so a UI control never binds to an
  // undefined/corrupt field (parity with overlay).
  faceChord: { schema: FaceChordSchema, complete: overDefaults(DEFAULT_FACE_CHORD) },
  // The sensitivity/degrees maps are filled from the defaults key by key, so a returning
  // user's older blob can't leave an emotion's slider unbound; the targets map is empty unless set.
  faceExpr: {
    schema: FaceExprSchema,
    complete: (stored) => {
      const pe = stored as Partial<FaceExpr>;
      return {
        sensitivity: { ...DEFAULT_FACE_EXPR.sensitivity, ...(pe.sensitivity ?? {}) },
        degrees: { ...DEFAULT_FACE_EXPR.degrees, ...(pe.degrees ?? {}) },
        // H6 of #613: absent on every blob saved before targets existed = no targets (degrees).
        // Only string values survive (a malformed one is dropped, not the whole face map).
        targets: { ...DEFAULT_FACE_EXPR.targets, ...Object.fromEntries(Object.entries((pe.targets ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) },
      };
    },
  },
  // Older blobs lack it entirely → the default index-source, no-routing map, so a returning
  // user can never leave a finger route or knob unbound.
  handMap: { schema: HandMapSchema },
  // The hands reading (#148): a pre-#148 blob has none → dwell 0 (the raw label).
  hands: { schema: HandsSettingsSchema, complete: overDefaults(DEFAULT_HANDS) },
  // The face-control axes (#76): a pre-#76-dials blob has none → the shipped tuning; a
  // partial one is completed; a corrupt one falls back whole rather than leaving the panel to
  // dereference an undefined into a NaN slider.
  //
  // Parsed RAW, unlike the `faceChord` rule above which pre-spreads its defaults. That is not
  // an inconsistency to tidy up later: EVERY field of this schema carries a `.default(...)`,
  // so `parse` already completes a partial blob, and the spread would be dead code that a
  // reader would mistake for load-bearing. The invariant it relies on is enforced at import
  // time, not by convention — `DEFAULT_FACE_CONTROLS_DIAL` is built by
  // `FaceControlsDialSchema.parse({})`, which throws on the day someone adds a field without
  // a default. (A mutation test caught the spread: removing it left the suite fully green,
  // which is the definition of a guard that guards nothing.)
  faceControls: { schema: FaceControlsDialSchema },
  // The gesture prefs (#129), completed over the current (default) prefs. The blob's
  // `bindings` record replaces the default wholesale (an unbound-by-the-user gesture must
  // STAY unbound, not be re-seeded every load).
  gestures: { schema: GesturePrefsSchema, complete: overCurrent },
  // The per-device audio pref (#240): a pre-#240 blob has none → the default hint.
  audioPrefs: { schema: AudioPrefsSchema, complete: overCurrent },
};

/** A flat slice's heal (#600 S13): field by field, as each field is a dial of its own: a field that
 *  parses is kept (one the stored object lacks parses to its default, as core's `healMidi` did), a
 *  corrupt one keeps the current value alone and never resets its siblings. */
const overCurrentFields = (slice: DialSlice) => (stored: unknown, current: unknown): unknown => {
  const out: Record<string, unknown> = { ...(current as object) };
  for (const [field, schema] of flatFields(slice)) {
    const parsed = schema.safeParse((stored as Record<string, unknown> | undefined)?.[field]);
    if (parsed.success) out[field] = parsed.data;
  }
  // A partial field value completed from the default (#600 S14), as a saved instrument's is.
  for (const [field, complete] of Object.entries(slice.complete ?? {})) out[field] = complete(out[field]);
  return out;
};

/** The extensions' dials, each healed through its own slice schema over the current value, like
 *  the conductor; a flat one field by field. */
export const EXTENSION_HEAL_RULES: Readonly<Record<string, HealRule<unknown>>> = Object.fromEntries([
  ...CONTRIBUTIONS.dialSlices.map((slice) => [slice.key, { schema: EXTENSION_DIAL_SCHEMAS[slice.key], complete: slice.layout === 'flat' ? overCurrentFields(slice) : overCurrent }]),
  // The extensions' per-device prefs (#600 S9), healed the same way.
  ...CONTRIBUTIONS.prefSlices.map((p) => [p.key, { schema: p.schema, complete: overCurrent }]),
]);

/** Every rule of `rules` applied to `stored` over `current`: the healed fields only. */
export function healAll(stored: Record<string, unknown>, current: Record<string, unknown>, rules: Readonly<Record<string, HealRule<unknown> | undefined>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, rule] of Object.entries(rules)) if (rule) out[field] = heal(stored[field], current[field], rule);
  return out;
}

