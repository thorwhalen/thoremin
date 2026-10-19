/**
 * The hot store's persist migration chain for its CORE fields (`thoremin-controls`'s global
 * version, zustand's `version` / `migrate`), out of `store.ts` since #600 S9, beside the
 * per-slice chains of the extensions' dials and prefs (`src/host/slices.ts`), which carry their
 * own versions in the blob's `sliceVersions`. `store.ts` wraps {@link migrateCoreControls} as its typed `migrateControls`.
 */
import { legacyFaceToMapping } from '@thoremin/sdk/nodes/domain';
import { LEGACY_CONDUCTOR_PRIOR } from '@/settings/schema';

/** A copy of a settings sub-object with its legacy `instrument` timbre field renamed to
 *  `sound`, so a returning player keeps their selection after the rename. A copy, never an
 *  edit: the object belongs to the caller's persisted blob. */
function migrateInstrumentField(o: Record<string, unknown>): Record<string, unknown> {
  const { instrument, ...rest } = o;
  return instrument !== undefined && rest.sound === undefined ? { ...rest, sound: instrument } : rest;
}


/**
 * One step of the persist migration: a blob written at version `n` becomes a version `n + 1`
 * blob. A step returns a NEW blob and never edits its argument or anything nested in it: the
 * blob belongs to the caller (zustand's rehydrated value), and `migrateControls` is tested
 * directly for exactly that (test/store_migrate_no_mutation.test.ts).
 */
type ControlsMigration = (s: Record<string, unknown>) => Record<string, unknown>;

/**
 * The persist version this build writes, and its history. Only some versions carry a data
 * transform (they are the steps in {@link CONTROLS_MIGRATIONS}, which repeat the reason
 * beside the code); the rest are ADDITIVE schema growth that {@link mergeControls} heals
 * (a field an older blob lacks takes its default), so the bump is only the version marker.
 *
 * - v2 (#64): the face-mapping chooser replaced the boolean `faceEnabled` with the
 *   tri-state `faceMapping`. Step.
 * - v3: the per-hand / chord timbre field was renamed `instrument` → `sound`. Step.
 * - v4: added the `handMap`.
 * - v5: the abstention retune raised the fearful/disgusted sensitivity default 0.5 → 0.7,
 *   delivered to a returning player who never customized it. Step.
 * - v6: #75 (decoupled chord-source scale — faceChord.chordSource/chordRoot/chordType) +
 *   #63 (per-voice octave RANGE — right/left.rangeLow/rangeHigh). Both ADDITIVE with
 *   defaults: mergeControls re-parses faceChord through FaceChordSchema (filling
 *   chordSource='auto' etc. for returning users → identical sound on their seven-note
 *   melodies), and the range fields are optional (absent → the legacy `octaves` scale path,
 *   byte-identical).
 * - v7 (#136): the Feature Lab moved out of the `overlay` dial onto its own per-device
 *   `featureLab` field (a tooling pref, like `faceCalibration`). Step.
 * - v8 (#137): the `midi` preset field (enabled/port), default off / first available port.
 * - v9 (#129): the `gestures` per-device tooling pref (enable flag, hold/cooldown timing,
 *   gesture → command bindings), defaults disabled; fist → silence, pinch → restore
 *   volume, open unbound.
 * - v10 (#76): the `faceControls` preset field (per-axis gain / deadzone / neutral zero /
 *   smoothing for the head-pose control mode). Its default is the shipped tuning, which is
 *   byte-identical to the build-time params the node used before the dial existed, so a
 *   returning player's `controls` mode sounds and feels exactly as it did.
 * - v11 (#188): the `steer` preset field (the generative layer: enabled / volume /
 *   config), default off. The transport (`steerPlaying`) is transient and not persisted,
 *   like `muted`.
 * - v12 (#187): the `conductor` preset field (the conductor node's params: off by default,
 *   hand/point, servo horizon, fallback + dynamics ranges).
 * - v13 (#186): `body` + `bodyMap` (a pre-#186 blob reads as off / no routes).
 * - v14 (#233): `airDrum` (the air-drum node's params, off by default).
 * - v15 (#249): `airBass`, the same way. v16: `airGuitar`. v17: `airFlute`.
 * - v18: the trainer HUD pref's default flipped to off (the Trainer's banner is the
 *   on-screen instruction now). Step.
 * - v19 (#263): `airFlute.prior` (the fingering-chart prior: on, the flute chart, strength
 *   10, C4..C#6).
 * - v20 (#269): `airDrum.pattern` (the trained pattern in play, '' for none).
 * - v21 (#232): the conductor dial gained `prior`; a returning player's conductor stays on
 *   the oscillator (LEGACY_CONDUCTOR_PRIOR). Step.
 * - v22 (#148): `hands` (the handedness dwell, default 0 = the raw per-frame label every
 *   earlier blob played by); healed after the v21 step runs.
 * - v23 (#168 Q3): `midi.muteFollowsMaster` (default true = the master mute silences MIDI,
 *   as every earlier blob played), healed field by field by healMidi.
 * - v24 (#240): `audioPrefs`, a per-device tooling pref (not a preset field): `lowLatency`,
 *   default off = the `interactive` hint every earlier blob ran with.
 *   Then, WITHOUT a bump (#336, #187 PR 5): `conductor.orchestra` (the sampled orchestra:
 *   on/off, overall and per-section level), default DEFAULT_ORCHESTRA. ADDITIVE and nested
 *   in the conductor dial, so the conductor heal (the schema parse over the current
 *   conductor) fills it for any earlier blob; no transform was ever needed, and this line
 *   is its history entry. A later bump is not owed for it.
 * - v25 (#186 PR G): `songPrefs`, a per-device tooling pref (not a preset field): the
 *   song's level and rate, defaults 0.8 / 1. The song itself and its transport are
 *   transient and never persisted.
 * - v26 (#186 PR H): `songPrefs` gained `follow` (default off: the song plays at its own
 *   tempo, as every earlier blob did) and `followRange` (0.1), healed over DEFAULT_SONG.
 *   Then, WITHOUT a bump (#375): `conductor.source` (`hands`) and `conductor.bodyPoint`
 *   (`impact`), additive in the conductor dial like `conductor.orchestra`; `hands` is what
 *   every earlier blob conducted with, so the conductor heal fills both and no transform
 *   is owed. And, WITHOUT a bump (#376): `conductor.markLevel` (`beat`), additive in the
 *   same way; `beat` is what every earlier blob marked. And, WITHOUT a bump (#377):
 *   `conductor.transport` (the body's start / hold / stop rules, `rules` on), additive and
 *   nested like `conductor.orchestra`; it acts only while the source is `body` (#375, the
 *   day before), so no earlier blob's hand conductor changes and no transform is owed.
 *   And, WITHOUT a bump (#427): `conductorPrefs` (the body conductor's lead offsets, a
 *   per-device pref like `songPrefs`), healed over DEFAULT_CONDUCTOR_PREFS: an earlier blob
 *   has none, which is no offset, what every earlier conductor played.
 *
 *   Then, WITHOUT a bump (#600 S9): the blob gains `sliceVersions`, each extension dial's and
 *   pref's own version (`src/host/slices.ts`); an earlier blob has none, which is version 1 for
 *   every slice, what each was. The extensions' slices migrate by their own chains, never here.
 *
 * Bump this and, if the change needs a transform, add `CONTROLS_MIGRATIONS[old]` together.
 */
export const CONTROLS_VERSION = 26;

/**
 * The persist migration steps, keyed by the version they READ (like
 * `CATEGORIZER_MIGRATIONS`): `CONTROLS_MIGRATIONS[n]` takes a version-n blob to n + 1. A
 * version with no entry needs no transform (see {@link CONTROLS_VERSION}'s history).
 */
const CONTROLS_MIGRATIONS: Readonly<Record<number, ControlsMigration>> = {
  // → v2 (#64): `faceEnabled` (boolean) → `faceMapping` (tri-state); an explicit
  // `faceMapping` wins over the legacy flag.
  1: ({ faceEnabled, ...rest }) =>
    rest.faceMapping === undefined ? { ...rest, faceMapping: legacyFaceToMapping(faceEnabled as boolean | undefined) } : rest,
  // → v3: the timbre field `instrument` → `sound`, so a returning player keeps their sound.
  2: (s) => {
    const out = { ...s };
    for (const key of ['right', 'left', 'faceChord'] as const) {
      const sub = s[key];
      if (sub && typeof sub === 'object') out[key] = migrateInstrumentField(sub as Record<string, unknown>);
    }
    return out;
  },
  // → v5: the abstention retune raised the fearful/disgusted firing default 0.5 → 0.7.
  // Deliver it to a returning player who never customized those two (persisted value
  // still === the OLD default), while preserving any value they DID set.
  4: (s) => {
    const fe = s.faceExpr as { sensitivity?: Record<string, number> } | undefined;
    if (!fe?.sensitivity) return s;
    const sensitivity = { ...fe.sensitivity };
    for (const e of ['fearful', 'disgusted'] as const) {
      if (sensitivity[e] === 0.5) sensitivity[e] = 0.7;
    }
    return { ...s, faceExpr: { ...fe, sensitivity } };
  },
  // → v7 (#136): the Feature Lab moved OUT of the `overlay` dial (an instrument parameter)
  // and onto its own per-device tooling field. Carry a returning player's lab config across
  // rather than dropping it on the floor: `overlay` is re-parsed through the lab-free
  // OverlayDialSchema in mergeControls, which would strip it silently (and drop the key
  // anyway; removing it here keeps the directly-tested migrate honest).
  6: (s) => {
    const ov = s.overlay as Record<string, unknown> | undefined;
    if (ov?.featureLab === undefined) return s;
    const { featureLab: lifted, ...overlay } = ov;
    return { ...s, featureLab: s.featureLab === undefined ? lifted : s.featureLab, overlay };
  },
  // → v18: the Trainer's running banner moved above every panel (it is now the on-screen
  // instruction), so painting the same words into the video is opt-in. A returning
  // player's persisted `show: true` is the OLD default, not a choice (nothing ever asked),
  // so it follows the new default once; re-ticking it in the panel sticks.
  17: (s) => {
    const hud = s.trainerHud as Record<string, unknown> | undefined;
    return hud && hud.show === true ? { ...s, trainerHud: { ...hud, show: false } } : s;
  },
  // → v21 (#232): the conductor dial gained `prior`, whose default (`blend`) is a behaviour
  // change. A returning player's conductor was the oscillator; it stays so (as a saved
  // instrument's does in `normalizeLayer`), and the panel's chooser is how they move.
  20: (s) => {
    const cond = s.conductor as Record<string, unknown> | undefined;
    return cond && typeof cond === 'object' && cond.prior === undefined ? { ...s, conductor: { ...cond, prior: LEGACY_CONDUCTOR_PRIOR } } : s;
  },
};

/** The steps as `[readVersion, step]`, oldest first: the order a chain must run in. */
const MIGRATION_CHAIN = Object.entries(CONTROLS_MIGRATIONS)
  .map(([from, step]) => [Number(from), step] as const)
  .sort((a, b) => a[0] - b[0]);

/**
 * Persist migration: run every step whose target version (`from + 1`) is above the blob's
 * (a version-`version` blob needs each step that produces a later version), oldest first.
 * Written as `version < from + 1`, not `version <= from`, so a non-integer version (1.5)
 * runs the same steps the original `version < n` chain did. The result is a new object
 * even when no step runs; the caller's blob is never edited. Exported for direct testing.
 */
export function migrateCoreControls(persisted: unknown, version: number): Record<string, unknown> {
  let s = { ...(persisted as Record<string, unknown>) };
  for (const [from, step] of MIGRATION_CHAIN) if (version < from + 1) s = step(s);
  return s;
}
