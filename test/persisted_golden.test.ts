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
 *
 * The last block (#741) pins the edges every load passes near: this build's own blob is a fixed
 * point, a newer build's blob (a rollback) heals and is written back at this version, an
 * envelope that is not JSON leaves the defaults, and a refused write-back loses nothing loaded.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIR, ASL, FACES, MIDI } from './helpers/extensions';
import { dropOldMirrorDefault } from '@thoremin/sdk/nodes/player_hands';

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
let SLICE_CHAINS: typeof import('@/app/store/migrations').SLICE_CHAINS;

beforeAll(async () => {
  store = await import('@/app/store');
  SLICE_CHAINS = (await import('@/app/store/migrations')).SLICE_CHAINS;
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

describe.runIf(SHIPPED)('the air overlay options moved with their elements (#600 S10, #655)', () => {
  beforeEach(() => localStorage.clear());
  // The legacy keys are gone from the overlay schema (#655): the move is checked against what the
  // STORED blob carried there (the defaults when it carried nothing), which the slice step reads raw.
  const DRUM_DEFAULT = { show: true };
  const MOUTH_DEFAULT = { show: true, position: 'left' };
  const storedOverlay = (v: number) => (JSON.parse(readFileSync(join(DIR, `controls.v${v}.json`), 'utf8')) as { state: { overlay?: Record<string, unknown> } }).state.overlay ?? {};

  for (const v of VERSIONS) {
    it(`v${v}: airDrum.padsOnVideo and airFlute.breathCue equal the stored overlay.drumPads and overlay.mouthCue`, async () => {
      const { useControls } = store;
      useControls.setState(useControls.getInitialState(), true);
      localStorage.setItem('thoremin-controls', readFileSync(join(DIR, `controls.v${v}.json`), 'utf8'));
      await useControls.persist.rehydrate();
      const s = useControls.getState() as unknown as Record<string, Record<string, unknown>>;
      const stored = storedOverlay(v);
      expect(s.airDrum.padsOnVideo).toEqual(stored.drumPads ?? DRUM_DEFAULT);
      expect(s.airFlute.breathCue).toEqual(stored.mouthCue ?? MOUTH_DEFAULT);
      // ...and the legacy keys no longer live in the overlay.
      expect(s.overlay).not.toHaveProperty('drumPads');
      expect(s.overlay).not.toHaveProperty('mouthCue');
    });
  }

  it('a returning player\'s saved instruments carry the same move', async () => {
    const library = JSON.parse(readFileSync(join(DIR, 'library.json'), 'utf8')) as Record<string, string>;
    for (const [k, val] of Object.entries(library)) localStorage.setItem(k, val);
    const { instruments, normalizeLayer } = await import('@/app/dials/instruments');
    for (const name of ['My Lab Rig', 'Pentatonic']) {
      const raw = (await instruments.load(name))! as Record<string, Record<string, unknown> | undefined>;
      const layer = normalizeLayer(raw as never) as Record<string, Record<string, unknown>>;
      expect(layer.airDrum.padsOnVideo, name).toEqual(raw.overlay?.drumPads ?? DRUM_DEFAULT);
      expect(layer.airFlute.breathCue, name).toEqual(raw.overlay?.mouthCue ?? MOUTH_DEFAULT);
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
    // A core device pref that became a slice's (#600 S15: the song's `songPrefs`; S16b: the Lab's) is pinned the same
    // way: the stored shape it had is what an older build reads back.
    // So is a core object dial that became one (#600 S18b: `conductor`, and its `conductorPrefs`; S16b: the Lab's `featureLab`; S16d: the Trainer's `trainerHud`).
    const FORMER_CORE_PREFS = new Set(['songPrefs', 'conductorPrefs', 'featureLab', 'trainerHud']);
    const FORMER_CORE_DIALS = new Set(['conductor']);
    const pinned = new Set([...CONTRIBUTIONS.dialSlices.filter((sl) => sl.layout === 'flat' || FORMER_CORE_DIALS.has(sl.key)).map((sl) => sl.key), ...CONTRIBUTIONS.prefSlices.filter((sl) => FORMER_CORE_PREFS.has(sl.key)).map((sl) => sl.key)]);
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

/**
 * The edges the per-version goldens do not reach (#741): what every load of this build's own
 * blob does, a blob from a NEWER build (a rollback), an envelope that is not JSON, and a storage
 * that refuses the write-back. A slice whose chain re-runs on its own version is
 * `host_slices.test.ts`'s to catch; these pin the core chain and the storage.
 */
describe.runIf(SHIPPED)('the edges of rehydration (#741)', () => {
  beforeEach(() => localStorage.clear());
  const KEY = 'thoremin-controls';
  const blobOf = (v: number) => JSON.parse(readFileSync(join(DIR, `controls.v${v}.json`), 'utf8')) as { state: Record<string, Record<string, unknown>>; version: number };
  const newest = () => blobOf(VERSIONS.length);
  const stored = () => localStorage.getItem(KEY);

  /** Rehydrate a fresh store from `raw`, and return its state as data. */
  async function rehydrateFrom(raw: string) {
    const { useControls } = store;
    useControls.setState(useControls.getInitialState(), true);
    localStorage.setItem(KEY, raw);
    await useControls.persist.rehydrate();
    return asData(useControls.getState()) as Record<string, unknown>;
  }

  it('what this build writes rehydrates to itself through no migration, and storage stays byte-equal', async () => {
    const first = await rehydrateFrom(JSON.stringify(newest()));
    const written = JSON.stringify({ state: store.persistedControls(store.useControls.getState()), version: VERSIONS.length });
    const options = store.useControls.persist.getOptions();
    const migrate = vi.fn(options.migrate!);
    store.useControls.persist.setOptions({ migrate });
    try {
      expect(await rehydrateFrom(written)).toEqual(first);
      expect(migrate).not.toHaveBeenCalled();
      // A change to a field that is not persisted writes nothing new: the stored blob is the fixed point.
      store.useControls.setState({ muted: !store.useControls.getState().muted } as never);
      expect(stored()).toBe(written);
    } finally {
      store.useControls.persist.setOptions({ migrate: options.migrate });
    }
  });

  it('a blob from a newer build (a rollback) runs no step, heals, and is overwritten at this build\'s version on load', async () => {
    const reference = await rehydrateFrom(JSON.stringify(newest()));
    const future = { ...newest(), version: VERSIONS.length + 1 };
    // A value a step would change if one ran (step 17 sets the trainer hud's show flag), slice
    // versions ahead of this build's chains, and a field this build does not know.
    // A newer build wrote its hand dials with the true-hand default (#995), as this build's steps
    // turn the fixture's: drop the old `mirrorHandedness: true` the fixture's build stored.
    const stateNow = Object.fromEntries(Object.entries(future.state).map(([k, v]) => [k, dropOldMirrorDefault(v)])) as typeof future.state;
    future.state = {
      ...stateNow,
      trainerHud: { ...(future.state.trainerHud ?? {}), show: !(reference.trainerHud as Record<string, unknown>).show },
      sliceVersions: Object.fromEntries(SLICE_CHAINS.map((c) => [c.key, c.version + 1])) as never,
      aFieldFromTheFuture: { on: true },
    };
    const s = await rehydrateFrom(JSON.stringify(future));
    expect((s.trainerHud as Record<string, unknown>).show).toBe(future.state.trainerHud.show);
    expect({ ...s, trainerHud: undefined, aFieldFromTheFuture: undefined }).toEqual({ ...reference, trainerHud: undefined });
    // The version differs, so the persist middleware writes at the end of the load, before any
    // change: the newer build's blob is gone at once, written back in this build's shape (the
    // documented trade-off in `src/host/slices.ts`). The unknown field may linger in memory, but
    // nothing writes it.
    const back = JSON.parse(stored()!) as { state: Record<string, unknown>; version: number };
    expect(back.version).toBe(VERSIONS.length);
    expect(back.state).not.toHaveProperty('aFieldFromTheFuture');
    expect(back.state.sliceVersions).toEqual(Object.fromEntries(SLICE_CHAINS.map((c) => [c.key, c.version])));
  });

  it('an envelope that is not JSON leaves the defaults, is kept until the first write, then replaced', async () => {
    const defaults = asData(store.useControls.getInitialState());
    const raw = '{"state": {"masterVolume": 0.9, ';
    expect(await rehydrateFrom(raw)).toEqual(defaults);
    expect(stored()).toBe(raw);
    store.useControls.setState({ masterVolume: 0.31 } as never);
    const back = JSON.parse(stored()!) as { version: number };
    expect(back.version).toBe(VERSIONS.length);
  });

  it('a storage that refuses the write-back of a migrated blob (quota) still hydrates to the golden state', async () => {
    const older = VERSIONS.length - 1;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    try {
      localStorage.setItem(KEY, readFileSync(join(DIR, `controls.v${older}.json`), 'utf8'));
      setItem.mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
      const { useControls } = store;
      useControls.setState(useControls.getInitialState(), true);
      // A migrated blob is written back inside the hydration; a throw there would leave the store
      // marked unhydrated.
      await useControls.persist.rehydrate();
      expect(setItem).toHaveBeenCalled();
      expect(useControls.persist.hasHydrated()).toBe(true);
      await expect(pretty(useControls.getState())).toMatchFileSnapshot(golden(`controls.v${older}.state.json`));
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
    }
  });
});
