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
import { AIR, ASL, FACES } from './helpers/extensions';

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
const SHIPPED = AIR && ASL && FACES;

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
