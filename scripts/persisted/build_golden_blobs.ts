/**
 * Builds the golden persisted-state blobs (#600 S2): `test/fixtures/persisted/controls.v{1..26}.json`,
 * one blob per historical persist version of the hot store (`thoremin-controls`), as the build
 * at that version wrote it. Run once and committed; the blobs are FROZEN data, and this script
 * is their provenance, not something a test runs.
 *
 *   npx vite-node scripts/persisted/build_golden_blobs.ts
 *
 * And `test/fixtures/persisted/library.json`: a returning player's localStorage for the
 * instrument library (the saved instruments under `thoremin.instruments`, an older seed
 * version, a selected and a default instrument, custom tags and per-instrument metadata),
 * with instruments saved by older builds (see {@link legacyInstruments}).
 *
 * How a version-n blob is made:
 *  - its FIELD SET is the one the last build at version n persisted, read from git at that
 *    commit (the settings schema's keys plus the store's `partialize` extras; listed in
 *    {@link FIELDS_BY_VERSION}). That is why v1 has four fields and a stale `recordingFormats`
 *    lives until v5: the store wrote it then, and a returning player's blob still has it;
 *  - its VALUES are a player's: the shipped defaults with a few deliberate customisations, so a
 *    migration that dropped a choice would show in the golden (a bell timbre on the right hand,
 *    a C# root, a face mapping, an edited expression slider, an air drum turned on);
 *  - every documented SHAPE change (`CONTROLS_VERSION`'s history in `src/app/store.ts`) is undone
 *    walking down from v26: a field a version added is absent below it, a renamed field has its
 *    old name, a default a step re-delivers has its old value.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A memory localStorage, installed BEFORE the app modules load (they pick their storage at
// import), so the library half below writes through the real providers and this script reads
// back exactly what a browser would hold.
const memory = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, String(v)),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() {
    return memory.size;
  },
};
const { useControls } = await import('@/app/store');
const { SEED_INSTRUMENTS, instruments } = await import('@/app/dials/instruments');
const library = await import('@/app/library/store');

type Blob = Record<string, unknown>;

/** The fields the last build of each version persisted (from git: the settings schema and `partialize`). */
const CORE_V2_V3 = ['right', 'left', 'syncHands', 'masterVolume', 'faceMapping', 'faceChord', 'faceExpr', 'overlay'];
const FIELDS_BY_VERSION: Record<number, readonly string[]> = {
  1: ['right', 'left', 'syncHands', 'masterVolume', 'faceEnabled', 'overlay', 'recordingFormats'],
  2: [...CORE_V2_V3, 'recordingFormats'],
  3: [...CORE_V2_V3, 'recordingFormats'],
  4: [...CORE_V2_V3, 'handMap', 'recordingFormats', 'faceCalibration'],
};
// v5 onward: octaveShift and magnetism join; then each version's additions.
const V5 = ['right', 'left', 'syncHands', 'masterVolume', 'octaveShift', 'magnetism', 'faceMapping', 'faceChord', 'faceExpr', 'overlay', 'handMap'];
FIELDS_BY_VERSION[5] = [...V5, 'recordingFormats', 'faceCalibration'];
FIELDS_BY_VERSION[6] = [...V5, 'faceCalibration'];
FIELDS_BY_VERSION[7] = [...V5, 'faceCalibration', 'featureLab'];
FIELDS_BY_VERSION[8] = [...V5, 'midi', 'faceCalibration', 'featureLab'];
FIELDS_BY_VERSION[9] = [...V5, 'midi', 'faceCalibration', 'featureLab', 'gestures'];
FIELDS_BY_VERSION[10] = [...V5, 'midi', 'body', 'faceControls', 'faceCalibration', 'featureLab', 'gestures', 'trainerHud'];
FIELDS_BY_VERSION[11] = [...FIELDS_BY_VERSION[10], 'steer'];
FIELDS_BY_VERSION[12] = [...FIELDS_BY_VERSION[11], 'conductor'];
FIELDS_BY_VERSION[13] = [...FIELDS_BY_VERSION[12], 'bodyMap'];
FIELDS_BY_VERSION[14] = [...FIELDS_BY_VERSION[13], 'airDrum'];
FIELDS_BY_VERSION[15] = [...FIELDS_BY_VERSION[14], 'airBass'];
FIELDS_BY_VERSION[16] = [...FIELDS_BY_VERSION[15], 'airGuitar'];
FIELDS_BY_VERSION[17] = [...FIELDS_BY_VERSION[16], 'airFlute'];
for (let v = 18; v <= 21; v++) FIELDS_BY_VERSION[v] = FIELDS_BY_VERSION[17];
FIELDS_BY_VERSION[22] = [...FIELDS_BY_VERSION[17], 'hands'];
FIELDS_BY_VERSION[23] = FIELDS_BY_VERSION[22];
FIELDS_BY_VERSION[24] = [...FIELDS_BY_VERSION[22], 'audioPrefs'];
FIELDS_BY_VERSION[25] = [...FIELDS_BY_VERSION[24], 'songPrefs'];
// v26 is today's blob (every persisted field), filled in from the store below.

const omit = (o: unknown, ...keys: string[]): Blob => {
  const out = { ...(o as Blob) };
  for (const k of keys) delete out[k];
  return out;
};

/** Today's persisted blob, as the store writes it, with a player's customisations. */
function playerBlobV26(): Blob {
  const s = useControls.getState();
  const partialize = useControls.persist.getOptions().partialize!;
  const blob = structuredClone(partialize(s)) as Blob;
  blob.right = { ...(blob.right as Blob), root: 1, sound: 'bell' };
  blob.left = { ...(blob.left as Blob), sound: 'reed' };
  blob.masterVolume = 0.55;
  blob.faceMapping = 'chord';
  const fe = blob.faceExpr as { sensitivity: Record<string, number>; degrees: Record<string, number> };
  blob.faceExpr = { ...fe, sensitivity: { ...fe.sensitivity, happy: 0.42 } };
  blob.airDrum = { ...(blob.airDrum as Blob), enabled: true };
  blob.midi = { ...(blob.midi as Blob), enabled: true, port: 'IAC Bus 1' };
  return blob;
}

/** Undo the shape change version `v + 1` made: a version-(v+1) blob becomes a version-v blob. */
function downgrade(next: Blob, v: number): Blob {
  let b: Blob = { ...next };
  switch (v) {
    case 25: // v26 added songPrefs.follow and .followRange
      b.songPrefs = omit(b.songPrefs, 'follow', 'followRange');
      break;
    case 23: // v24 added audioPrefs (field set) and, without a bump, conductor.orchestra
      b.conductor = omit(b.conductor, 'orchestra');
      break;
    case 22: // v23 added midi.muteFollowsMaster
      b.midi = omit(b.midi, 'muteFollowsMaster');
      break;
    case 20: // v21 added conductor.prior
      b.conductor = omit(b.conductor, 'prior');
      break;
    case 19: // v20 added airDrum.pattern
      b.airDrum = omit(b.airDrum, 'pattern');
      break;
    case 18: // v19 added airFlute.prior
      b.airFlute = omit(b.airFlute, 'prior');
      break;
    case 17: // v18 flipped the trainer HUD default to off; a v17 blob carries the old default
      b.trainerHud = { ...(b.trainerHud as Blob), show: true };
      break;
    case 6: // v7 lifted the Feature Lab out of the overlay dial
      b.overlay = { ...(b.overlay as Blob), featureLab: b.featureLab };
      break;
    case 5: // v6 added the chord-source fields and the per-voice octave range
      b.faceChord = omit(b.faceChord, 'chordSource', 'chordRoot', 'chordType');
      b.overlay = omit(b.overlay, 'featureLab'); // the Feature Lab (#119) came after v6's changes
      b.right = omit(b.right, 'rangeLow', 'rangeHigh');
      b.left = omit(b.left, 'rangeLow', 'rangeHigh');
      break;
    case 4: { // v5 re-delivered the fearful/disgusted sensitivity default 0.5 -> 0.7
      const fe = b.faceExpr as { sensitivity: Record<string, number> };
      b.faceExpr = { ...fe, sensitivity: { ...fe.sensitivity, fearful: 0.5, disgusted: 0.5 } };
      break;
    }
    case 2: // v3 renamed the timbre field `sound` -> `instrument`
      for (const k of ['right', 'left', 'faceChord']) {
        const { sound, ...rest } = b[k] as Blob;
        b[k] = { ...rest, instrument: sound };
      }
      break;
    case 1: // v2 replaced faceEnabled with faceMapping
      b = { ...omit(b, 'faceMapping'), faceEnabled: true };
      break;
    default:
      break;
  }
  return b;
}

/** Keep exactly the fields version `v` persisted (and a stale `recordingFormats` where it lived). */
function fieldsOf(b: Blob, v: number): Blob {
  if (v === 26) return b;
  const out: Blob = {};
  for (const k of FIELDS_BY_VERSION[v]) {
    if (k === 'recordingFormats') out[k] = ['webm'];
    else if (k in b) out[k] = b[k];
  }
  return out;
}

const OUT = 'test/fixtures/persisted';
mkdirSync(OUT, { recursive: true });
let full = playerBlobV26();
const blobs: Record<number, Blob> = { 26: full };
for (let v = 25; v >= 1; v--) {
  full = downgrade(full, v);
  blobs[v] = fieldsOf(full, v);
}
for (let v = 1; v <= 26; v++) {
  // zustand's persist envelope: what localStorage holds under `thoremin-controls`.
  writeFileSync(join(OUT, `controls.v${v}.json`), `${JSON.stringify({ state: blobs[v], version: v }, null, 2)}\n`);
}
console.log(`wrote ${OUT}/controls.v1..26.json`);

/**
 * Instruments as older builds saved them: each carries the drift `normalizeLayer` heals.
 *  - "My Lab Rig" (before #136/#137/#232/#263/#202): the Feature Lab inside the overlay, no
 *    `midi.*` keys, a conductor with no `prior`, an air flute with no `prior`, a partial steering
 *    config;
 *  - "Pentatonic", a SHIPPED name the player edited: the seeder must never overwrite it.
 */
function legacyInstruments(): { name: string; layer: Record<string, unknown> }[] {
  const base = structuredClone(SEED_INSTRUMENTS[0].layer) as Record<string, unknown>;
  const rig: Record<string, unknown> = { ...base };
  for (const k of ['midi.enabled', 'midi.port', 'midi.muteFollowsMaster', 'hands.handednessDwell']) delete rig[k];
  rig.overlay = { ...(base.overlay as Blob), featureLab: { show: true, groups: ['face.mouth'] } };
  rig.conductor = omit({ ...(base.conductor as Blob), enabled: true }, 'prior');
  rig.airFlute = omit(base.airFlute, 'prior');
  rig.steerConfig = { smoothing: 0.4, throttleSec: 2 };
  rig['right.sound'] = 'bell';
  const edited: Record<string, unknown> = { ...base, 'master.volume': 0.2, 'right.sound': 'reed' };
  return [
    { name: 'My Lab Rig', layer: rig },
    { name: 'Pentatonic', layer: edited },
  ];
}

for (const { name, layer } of legacyInstruments()) await instruments.save(name, layer);
localStorage.setItem('thoremin.instruments.seedVersion', '5');
localStorage.setItem('thoremin.instruments.selected', 'My Lab Rig');
localStorage.setItem('thoremin.instruments.default', 'Pentatonic');
const practice = await library.resolveOrCreateTag('Practice', { rng: () => 0 });
const loud = await library.resolveOrCreateTag('Loud & Clear', { rng: () => 0.5 });
await library.writeInstrumentMeta({
  'My Lab Rig': { starred: true, tagIds: [practice.id, loud.id] },
  Pentatonic: { starred: false, tagIds: [loud.id] },
  // Metadata for an instrument the player has since deleted: kept, inert.
  'Deleted Long Ago': { starred: true, tagIds: [practice.id] },
});
// A corrupt entry from a bad write, which the reader heals away.
const meta = JSON.parse(localStorage.getItem('thoremin.library.instrumentMeta')!) as Record<string, unknown>;
meta['Half Written'] = { starred: 'yes' };
localStorage.setItem('thoremin.library.instrumentMeta', JSON.stringify(meta));
writeFileSync(join(OUT, 'library.json'), `${JSON.stringify(Object.fromEntries([...memory.entries()].sort()), null, 2)}\n`);
console.log(`wrote ${OUT}/library.json`);
