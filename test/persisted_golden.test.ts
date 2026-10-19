// @vitest-environment jsdom
/**
 * Golden persisted state (#600 S2): what a RETURNING player gets, for every persist version the
 * hot store ever wrote, through the whole real chain at once.
 *
 * Each migration step and heal rule has its own unit test (`app_store`, `store_heal_rules`,
 * `conductor_prior_migration`, `instrument_hush`, `feature_lab_config`), but nothing ran a real
 * old blob through all of them together: the persist middleware's rehydrate (`migrateControls`
 * from the blob's version, then `mergeControls` and its heal rules) over a fresh store. The
 * vertical-slices refactor (`docs/design/vertical-slices.md`) moves state between modules
 * (per-slice migrations, prefs split from presets, extension overlay elements); this is the test
 * that fails, loudly, if any of that changes what a player who left at version n comes back to.
 *
 * The blobs (`test/fixtures/persisted/controls.v{1..26}.json`, zustand's persist envelope as
 * localStorage holds it) and the library (`library.json`, a localStorage snapshot: saved
 * instruments from older builds, an older seed version, tags and metadata) are frozen data;
 * `scripts/persisted/build_golden_blobs.ts` is their provenance. The goldens they produce are
 * the `__golden__/*.json` files beside them. A change that is MEANT to change what a returning
 * player gets regenerates them (`npx vitest run test/persisted_golden.test.ts -u`) and says why
 * in its PR; any other diff there is a bug.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIR, ASL, FACES, MIDI } from './helpers/extensions';

const DIR = join('test', 'fixtures', 'persisted');
const VERSIONS = Array.from({ length: 26 }, (_, i) => i + 1);

/** The state as data: setters dropped, keys sorted, so a golden diff is a data diff. */
function asData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(asData);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => typeof v !== 'function')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, asData(v)]),
    );
  }
  return value;
}

/** The goldens are the SHIPPED build's (the blobs carry the extensions' dials, which a build
 *  without them drops); the core-alone run skips them rather than comparing another build. */
const SHIPPED = AIR && ASL && FACES && MIDI;

const golden = (name: string): string => `./fixtures/persisted/__golden__/${name}`;
const pretty = (v: unknown): string => `${JSON.stringify(asData(v), null, 2)}\n`;

let store: typeof import('@/app/store');

beforeAll(async () => {
  store = await import('@/app/store');
});

describe.runIf(SHIPPED)('a returning player at every persist version', () => {
  beforeEach(() => localStorage.clear());

  it('the newest blob is the version this build writes (add a blob when the version is bumped)', () => {
    expect(store.useControls.persist.getOptions().version).toBe(VERSIONS.length);
  });

  for (const v of VERSIONS) {
    it(`v${v}: rehydrates through migrate, merge and heal to the golden state`, async () => {
      const { useControls } = store;
      useControls.setState(useControls.getInitialState(), true);
      localStorage.setItem('thoremin-controls', readFileSync(join(DIR, `controls.v${v}.json`), 'utf8'));
      await useControls.persist.rehydrate();
      await expect(pretty(useControls.getState())).toMatchFileSnapshot(golden(`controls.v${v}.state.json`));
    });
  }
});

/**
 * The air overlay elements' options moved out of core's overlay dial (#600 S10, the expand step):
 * `overlay.drumPads` into `airDrum.padsOnVideo`, `overlay.mouthCue` into `airFlute.breathCue`. For
 * every historical blob and every saved instrument, the moved value equals the one it came from
 * (still readable at the old key until the contract step), so what a returning player sees is
 * what they saw.
 */
describe.runIf(SHIPPED)('the chord map grid\'s show flag moved with its element (#610 item 4)', () => {
  beforeEach(() => localStorage.clear());

  for (const v of VERSIONS) {
    it(`v${v}: chordMap.gridOnVideo equals overlay.cellGrid`, async () => {
      const { useControls } = store;
      useControls.setState(useControls.getInitialState(), true);
      localStorage.setItem('thoremin-controls', readFileSync(join(DIR, `controls.v${v}.json`), 'utf8'));
      await useControls.persist.rehydrate();
      const s = useControls.getState() as unknown as Record<string, Record<string, unknown>>;
      expect(s.chordMap.gridOnVideo).toEqual(s.overlay.cellGrid);
    });
  }

  it('a hidden grid stays hidden: a blob with the chord map slice at version 1 moves a changed value', async () => {
    const { useControls } = store;
    useControls.setState(useControls.getInitialState(), true);
    const blob = JSON.parse(readFileSync(join(DIR, `controls.v${VERSIONS.length}.json`), 'utf8')) as { state: Record<string, Record<string, unknown>>; version: number };
    blob.state.overlay = { ...blob.state.overlay, cellGrid: { show: false } };
    blob.state.chordMap = { ...blob.state.chordMap, enabled: true };
    blob.state.sliceVersions = { ...(blob.state.sliceVersions ?? {}), chordMap: 1 };
    localStorage.setItem('thoremin-controls', JSON.stringify(blob));
    await useControls.persist.rehydrate();
    const s = useControls.getState() as unknown as Record<string, Record<string, unknown>>;
    expect(s.chordMap.gridOnVideo).toEqual({ show: false });
    expect(s.chordMap.enabled).toBe(true);
  });

  it('a saved instrument whose map predates the move carries its hidden grid', async () => {
    const { normalizeLayer, SEED_INSTRUMENTS } = await import('@/app/dials/instruments');
    const seed = structuredClone(SEED_INSTRUMENTS.find((i) => i.name === 'Chord Map')!.layer) as Record<string, Record<string, unknown>>;
    const { gridOnVideo: _g, ...oldMap } = seed.chordMap;
    void _g;
    const saved = { ...seed, chordMap: oldMap, overlay: { ...seed.overlay, cellGrid: { show: false } } };
    const layer = normalizeLayer(saved as never) as Record<string, Record<string, unknown>>;
    expect(layer.chordMap.gridOnVideo).toEqual({ show: false });
  });
});

describe.runIf(SHIPPED)('the air overlay options moved with their elements (#600 S10)', () => {
  beforeEach(() => localStorage.clear());

  for (const v of VERSIONS) {
    it(`v${v}: airDrum.padsOnVideo and airFlute.breathCue equal overlay.drumPads and overlay.mouthCue`, async () => {
      const { useControls } = store;
      useControls.setState(useControls.getInitialState(), true);
      localStorage.setItem('thoremin-controls', readFileSync(join(DIR, `controls.v${v}.json`), 'utf8'));
      await useControls.persist.rehydrate();
      const s = useControls.getState() as unknown as Record<string, Record<string, unknown>>;
      expect(s.airDrum.padsOnVideo).toEqual(s.overlay.drumPads);
      expect(s.airFlute.breathCue).toEqual(s.overlay.mouthCue);
    });
  }

  it('a returning player\'s saved instruments carry the same move', async () => {
    const library = JSON.parse(readFileSync(join(DIR, 'library.json'), 'utf8')) as Record<string, string>;
    for (const [k, val] of Object.entries(library)) localStorage.setItem(k, val);
    const { instruments, normalizeLayer } = await import('@/app/dials/instruments');
    for (const name of ['My Lab Rig', 'Pentatonic']) {
      const layer = normalizeLayer((await instruments.load(name))!) as Record<string, Record<string, unknown>>;
      expect(layer.airDrum.padsOnVideo, name).toEqual(layer.overlay.drumPads);
      expect(layer.airFlute.breathCue, name).toEqual(layer.overlay.mouthCue);
    }
  });

  it('a blob S9 wrote (air slices at version 1) moves a changed value too, and a corrupt one costs only itself', async () => {
    const { useControls } = store;
    const base = JSON.parse(readFileSync(join(DIR, `controls.v${VERSIONS.length}.json`), 'utf8')) as { state: Record<string, Record<string, unknown>>; version: number };
    const rehydrateWith = async (overlay: Record<string, unknown>) => {
      useControls.setState(useControls.getInitialState(), true);
      const blob = structuredClone(base);
      blob.state.overlay = { ...blob.state.overlay, ...overlay };
      blob.state.airDrum = { ...blob.state.airDrum, enabled: true, volume: 0.33 };
      blob.state.sliceVersions = { airDrum: 1, airFlute: 1 };
      localStorage.setItem('thoremin-controls', JSON.stringify(blob));
      await useControls.persist.rehydrate();
      return useControls.getState() as unknown as Record<string, Record<string, unknown>>;
    };
    const s = await rehydrateWith({ drumPads: { show: false }, mouthCue: { show: false, position: 'top' } });
    expect(s.airDrum.padsOnVideo).toEqual({ show: false });
    expect(s.airFlute.breathCue).toEqual({ show: false, position: 'top' });
    const corrupt = await rehydrateWith({ drumPads: { show: null } });
    expect(corrupt.airDrum.padsOnVideo).toEqual({ show: true });
    expect(corrupt.airDrum.enabled).toBe(true);
    expect(corrupt.airDrum.volume).toBe(0.33);
  });

  it('a saved instrument whose drum predates the move carries its changed values', async () => {
    const { normalizeLayer, SEED_INSTRUMENTS } = await import('@/app/dials/instruments');
    const seed = structuredClone(SEED_INSTRUMENTS.find((i) => i.name === 'Air Drum')!.layer) as Record<string, Record<string, unknown>>;
    const { padsOnVideo: _p, ...oldDrum } = seed.airDrum;
    void _p;
    const { breathCue: _b, ...oldFlute } = seed.airFlute;
    void _b;
    const saved = { ...seed, airDrum: oldDrum, airFlute: oldFlute, overlay: { ...seed.overlay, drumPads: { show: false }, mouthCue: { show: true, position: 'bottom' } } };
    const layer = normalizeLayer(saved as never) as Record<string, Record<string, unknown>>;
    expect(layer.airDrum.padsOnVideo).toEqual({ show: false });
    expect(layer.airFlute.breathCue).toEqual({ show: true, position: 'bottom' });
    expect(normalizeLayer(layer as never)).toEqual(layer);
  });

  it('a value the player changed is the one that moves (a hidden pad set, a breath cue on the right)', async () => {
    const { useControls } = store;
    useControls.setState(useControls.getInitialState(), true);
    const blob = JSON.parse(readFileSync(join(DIR, `controls.v${VERSIONS.length}.json`), 'utf8')) as { state: Record<string, Record<string, unknown>>; version: number };
    blob.state.overlay = { ...blob.state.overlay, drumPads: { show: false }, mouthCue: { show: true, position: 'right' } };
    localStorage.setItem('thoremin-controls', JSON.stringify(blob));
    await useControls.persist.rehydrate();
    const s = useControls.getState() as unknown as Record<string, Record<string, unknown>>;
    expect(s.airDrum.padsOnVideo).toEqual({ show: false });
    expect(s.airFlute.breathCue).toEqual({ show: true, position: 'right' });
  });
});

describe.runIf(SHIPPED)('what the store writes back (#600 S9)', () => {
  beforeEach(() => localStorage.clear());

  it('after the newest blob, the written blob keeps every preset and device-pref field and records each slice\'s version', async () => {
    const { useControls, persistedControls } = store;
    useControls.setState(useControls.getInitialState(), true);
    localStorage.setItem('thoremin-controls', readFileSync(join(DIR, `controls.v${VERSIONS.length}.json`), 'utf8'));
    await useControls.persist.rehydrate();
    const written = persistedControls(useControls.getState());
    // Core's fields are pinned exactly, and so is a FLAT slice's (#600 S13: a built-in feature that
    // became a slice keeps the stored shape it had, `midi`); an extension's object slices
    // structurally (#600 S10), so a new extension dial needs no snapshot edit: each one is written
    // with its value and its version.
    const { CONTRIBUTIONS } = await import('@/host/contributions');
    const slices = [...CONTRIBUTIONS.dialSlices, ...CONTRIBUTIONS.prefSlices];
    const sliceKeys = new Set(slices.map((sl) => sl.key));
    // A core device pref that became a slice's (#600 S15: the song's `songPrefs`) is pinned the same
    // way: the stored shape it had is what an older build reads back.
    const FORMER_CORE_PREFS = new Set(['songPrefs']);
    const pinned = new Set([...CONTRIBUTIONS.dialSlices.filter((sl) => sl.layout === 'flat').map((sl) => sl.key), ...CONTRIBUTIONS.prefSlices.filter((sl) => FORMER_CORE_PREFS.has(sl.key)).map((sl) => sl.key)]);
    const core = Object.fromEntries(Object.entries(written).filter(([k]) => (!sliceKeys.has(k) || pinned.has(k)) && k !== 'sliceVersions'));
    await expect(pretty(core)).toMatchFileSnapshot(golden('controls.written.json'));
    const state = useControls.getState() as unknown as Record<string, unknown>;
    const versions = written.sliceVersions as Record<string, number>;
    for (const sl of slices) {
      expect(versions[sl.key], sl.key).toBe(sl.version ?? 1);
      expect(written[sl.key], `${sl.key} is written`).toBeDefined();
    }
    void state;
    expect(Object.keys(versions).sort()).toEqual([...sliceKeys].sort());
  });

});

describe.runIf(SHIPPED)('a returning player\'s instrument library', () => {
  beforeEach(() => {
    localStorage.clear();
    const library = JSON.parse(readFileSync(join(DIR, 'library.json'), 'utf8')) as Record<string, string>;
    for (const [k, v] of Object.entries(library)) localStorage.setItem(k, v);
  });

  it('the seeder adds the shipped instruments it lacks and keeps the player\'s own, and each resolves to the golden layer', async () => {
    const { ensureSeeded, instruments, normalizeLayer, getSelectedName, getDefaultName } = await import('@/app/dials/instruments');
    await ensureSeeded();
    const names = (await instruments.list()).map((p) => p.name);
    // The player's instruments resolve through the same normalisation a selection uses.
    const own: Record<string, unknown> = {};
    for (const name of ['My Lab Rig', 'Pentatonic']) own[name] = normalizeLayer((await instruments.load(name))!);
    await expect(pretty({ names, selected: getSelectedName(), default: getDefaultName(), own })).toMatchFileSnapshot(golden('library.instruments.json'));
  });

  it('the tags and per-instrument metadata read back healed', async () => {
    const { listTags, readInstrumentMeta } = await import('@/app/library/store');
    await expect(pretty({ tags: await listTags(), meta: await readInstrumentMeta() })).toMatchFileSnapshot(golden('library.meta.json'));
  });
});
