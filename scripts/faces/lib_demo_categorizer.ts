/**
 * Build the shipped demo shared categorizer (#330 P5) from the repo's real face recording
 * `video_face_expressions`: `public/categorizers/demo-smile.json` and its entry in
 * `public/categorizers/index.json`. It demonstrates the shared-categorizer mechanism and is
 * labelled a demo everywhere it shows: one person's three seconds of rest, a smile and a smile
 * with the mouth open. The real shared categorizers are recorded and exported by the maintainer
 * (Tools, Your faces, Export file) and added beside it.
 *
 * Deterministic: `test/faces/shared_categorizers.test.ts` rebuilds it and fails when the
 * committed file differs. The CLI is `build_demo_categorizer.ts` (`npm run faces:demo`).
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { SHARED_INDEX_FORMAT, type SharedEntry, type SharedIndex } from '@thoremin/ext-faces/lib/shared';
import { DISTANCE_PROXIES } from '@thoremin/ext-faces/lib/live';
import { recordedCategorizer, recordedFrames } from '../../test/helpers/faceRecording';

export const SHARED_PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'categorizers');

/** Decimal places kept in the shipped file (blendshapes are 0..1; jitter is about 1e-3). */
const DECIMALS = 5;

export const DEMO_ENTRY: SharedEntry = {
  name: 'demo-smile',
  label: 'Demo: smile and open smile',
  description:
    "Made from the app's own three-second test recording of one face: a rest, a smile, a smile with the mouth open. Two faces; a face near the rest is none of these.",
  demo: true,
};

const round = (x: number): number => Number(x.toFixed(DECIMALS));

/**
 * `c` as shipped: numbers rounded, and each sample keeping only what a categorizer reads (its
 * features, and the face's scale, which the distance tuning of a copy learns from). The
 * recording's other features (head angles, mesh geometry) would triple the file for nothing.
 */
function shipped(c: PersonalCategorizer): PersonalCategorizer {
  const keep = new Set<string>([...c.features, ...DISTANCE_PROXIES]);
  const vec = (v: Record<string, number>, only?: Set<string>) =>
    Object.fromEntries(Object.entries(v).filter(([k]) => !only || only.has(k)).map(([k, x]) => [k, round(x)]));
  return {
    ...c,
    weights: vec(c.weights),
    ...(c.rejectRadius !== undefined ? { rejectRadius: round(c.rejectRadius) } : {}),
    samples: c.samples.map((s) => ({ ...s, vector: vec(s.vector, keep), t: round(s.t) })),
  };
}

/** The demo categorizer file, as committed. */
export function buildDemoCategorizer(): PersonalCategorizer {
  const { createdAt: _drop, ...file } = recordedCategorizer(recordedFrames(), { name: DEMO_ENTRY.label, labels: ['smile', 'open smile'] }) as PersonalCategorizer & { createdAt?: string };
  return shipped(file);
}

/** The index with the demo entry in it (the other entries kept, in their order). */
export function indexWithDemo(existing: SharedIndex | null): SharedIndex {
  const others = (existing?.categorizers ?? []).filter((e) => e.name !== DEMO_ENTRY.name);
  return { format: SHARED_INDEX_FORMAT, version: 1, categorizers: [DEMO_ENTRY, ...others] };
}

/** One line per sample: readable in a diff, without a line per number. */
export function toJson(x: unknown): string {
  if (typeof x === 'object' && x !== null && Array.isArray((x as { samples?: unknown }).samples)) {
    const { samples, ...rest } = x as { samples: unknown[] };
    const head = JSON.stringify(rest, null, 1).replace(/\n}$/, '');
    return `${head},\n "samples": [\n${samples.map((s) => `  ${JSON.stringify(s)}`).join(',\n')}\n ]\n}\n`;
  }
  return `${JSON.stringify(x, null, 1)}\n`;
}
