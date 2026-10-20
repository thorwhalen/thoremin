/**
 * The seed sweep's manifest (`smoke/seed_instruments.json`) is the shipped instruments as data:
 * `smoke/tests/seeds.smoke.ts` loads every one of them in a real browser and asserts it composes,
 * logs no error and, where it should, sounds. This guard fails when a seed is added, renamed or
 * removed without an entry (so a new instrument cannot drop out of the sweep), when an entry's
 * `body` flag disagrees with the graph the seed composes, and when a seed expected silent under the
 * synthetic hands states no reason.
 */
import { describe, expect, it } from 'vitest';
import manifest from '../smoke/seed_instruments.json';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { layerToSettings } from '@/settings/dials';
import { branchIdsFor } from '@/app/graph';
import { AIR, ASL, hasExtension } from './helpers/extensions';

type Entry = { name: string; body: boolean; silent?: string };
const entries = manifest.seeds as Entry[];

// The manifest names the shipped build's seeds, extensions included: a core-alone build lists fewer.
describe.runIf(AIR && ASL && hasExtension('faces'))('the seed sweep manifest', () => {
  it('lists exactly the shipped instruments, in order', () => {
    expect(entries.map((e) => e.name)).toEqual(SEED_INSTRUMENTS.map((s) => s.name));
  });

  it('flags the seeds that compose the body camera', () => {
    for (const seed of SEED_INSTRUMENTS) {
      const composes = branchIdsFor(layerToSettings(seed.layer as Record<string, unknown>)).includes('body-source');
      expect(entries.find((e) => e.name === seed.name)?.body, seed.name).toBe(composes);
    }
  });

  it('gives a reason for every seed expected silent under the synthetic hands', () => {
    for (const e of entries) if (e.silent !== undefined) expect(e.silent.length, e.name).toBeGreaterThan(10);
  });
});
