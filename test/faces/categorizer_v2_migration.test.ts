/**
 * The categorizer file's version 2 (#385 E3), against every categorizer the repo ships or
 * keeps as a fixture: each version-1 file migrates to a version-2 file whose derived model is
 * BYTE-identical to the one version 1 derived (re-derived here the way version 1 did, from
 * positions), the migration is lossless (version 2 maps back to the same version-1 document),
 * and a version-2 file round-trips through export and import unchanged. The shipped demo,
 * kept at version 1 as `fixtures/demo_smile.v1.categorizer.json`, migrates to exactly the
 * version-2 file the builder now ships. `fixtures/synthetic_partition.v1.categorizer.json` is a
 * partition-mode version-1 file carved from the scripted face (made once, kept as data).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATEGORIZER_VERSION,
  NO_REJECT_RADIUS,
  exportCategorizer,
  importCategorizer,
  modelFromCategorizer,
  type PersonalCategorizer,
} from '@thoremin/sdk/enroll/categorizer';
import { trainModel } from '@thoremin/sdk/enroll/classify';
import type { TrainedModel } from '@thoremin/sdk/enroll/types';
import { liveModel } from '@thoremin/ext-faces/lib/live';
import { SHARED_PUBLIC_DIR } from '../../scripts/faces/lib_demo_categorizer';

const FIXTURES = join(__dirname, 'fixtures');

interface V1 {
  version: 1;
  mode: 'partition' | 'reject';
  k: number;
  features: string[];
  weights: Record<string, number>;
  rejectRadius?: number;
  samples: { vector: Record<string, number>; t: number; cue: string }[];
  categories: { id: string; label: string; members: number[] }[];
}

/** The model version 1 derived (its `modelFromCategorizer`, from positions). */
function v1Model(c: V1): TrainedModel {
  const trained = trainModel(c.samples.map((s) => s.vector), c.categories.map((x) => x.members), c.features, c.weights);
  return {
    ...trained,
    categories: trained.categories.map((cat, i) => {
      const cues = new Map<string, number>();
      for (const j of cat.members) cues.set(c.samples[j].cue, (cues.get(c.samples[j].cue) ?? 0) + 1);
      return { ...cat, id: c.categories[i].id, label: c.categories[i].label, cues: Object.fromEntries(cues) };
    }),
    rejectRadius: c.mode === 'reject' ? c.rejectRadius! : NO_REJECT_RADIUS,
  };
}

/** A version-2 file as version 1 (positions, `mode`, `k`): the migration's inverse. */
function asV1(c: PersonalCategorizer): Record<string, unknown> {
  const at = new Map(c.samples.map((x, i) => [x.id, i]));
  const { strangers, neutral: _n, aside: _a, pins: _p, ...rest } = c;
  void [_n, _a, _p];
  return {
    ...rest,
    version: 1,
    mode: strangers === 'neutral' ? 'reject' : 'partition',
    k: c.categories.length,
    samples: c.samples.map(({ id: _id, support: _s, ...x }) => x),
    categories: c.categories.map((cat) => ({ ...cat, members: cat.members.map((id) => at.get(id)) })),
  };
}

const read = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8'));
const files = [
  ...readdirSync(FIXTURES).filter((f) => f.endsWith('.categorizer.json')).map((f) => join(FIXTURES, f)),
  ...readdirSync(SHARED_PUBLIC_DIR).filter((f) => f !== 'index.json').map((f) => join(SHARED_PUBLIC_DIR, f)),
];

describe('every shipped and fixture categorizer, version 1 to version 2', () => {
  it('finds both kinds', () => {
    expect(files.some((f) => read(f).version === 1)).toBe(true);
    expect(files.some((f) => read(f).version === CATEGORIZER_VERSION)).toBe(true);
  });

  for (const path of files) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    it(`${name}: reads, derives the version-1 model byte for byte, and round-trips`, () => {
      const doc = read(path);
      const r = importCategorizer(doc);
      expect(r.ok, r.ok ? '' : r.error).toBe(true);
      if (!r.ok) return;
      const c = r.categorizer;
      expect(c.version).toBe(CATEGORIZER_VERSION);
      // A version-2 file through export and import is the identity.
      expect(importCategorizer(exportCategorizer(c))).toEqual({ ok: true, categorizer: c, migratedFrom: null });
      const v1 = (doc.version === 1 ? doc : asV1(c)) as unknown as V1;
      if (doc.version === 1) {
        expect(r.migratedFrom).toBe(1);
        // Lossless: version 2 maps back to the very document read.
        expect(asV1(c)).toEqual(doc);
      }
      expect(JSON.stringify(modelFromCategorizer(c))).toBe(JSON.stringify(v1Model(v1)));
      // The live model (the tuning's floor, the distance fit, the rest) trains on the same
      // members, category for category.
      const live = liveModel(c).model;
      expect(live.categories.map((x) => [x.id, x.members])).toEqual(v1Model(v1).categories.map((x) => [x.id, x.members]));
    });
  }

  it('the shipped demo at version 1 migrates to exactly the version-2 file the builder ships', () => {
    const v1 = importCategorizer(read(join(FIXTURES, 'demo_smile.v1.categorizer.json')));
    const v2 = importCategorizer(read(join(SHARED_PUBLIC_DIR, 'demo-smile.json')));
    expect(v1.ok && v2.ok).toBe(true);
    if (v1.ok && v2.ok) expect(v1.categorizer).toEqual(v2.categorizer);
  });
});
