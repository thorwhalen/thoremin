/**
 * Turn an `an.impacts` clip into a small committed replay fixture for the impact
 * predictor's tests.
 *
 *   npx vite-node scripts/subframe/build_fixture.ts <clip dir> <fixture name>
 *
 * Writes `test/fixtures/<fixture name>/` with:
 *
 * - `keypoints.ndjson` — the clip's observation stream, verbatim (the recorder's
 *   shape: `{tick, t, value: {width, height, keypoints: [{object, name, x, y}]}}`);
 * - `truth.json` — the clip's ground truth with the per-frame table dropped (it is the
 *   bulk of the file and the tests need only the events): `spec`, `clip`, `objects`
 *   (name and impact keypoint), `events` (index, beat, t_grid, t_impact, kind,
 *   amplitude, impact_xy, the frame-snapped baseline's `lowest_error`);
 * - `meta.json` — where it came from and how to regenerate it.
 *
 * Synthetic data made by our own generator may be committed; the full sets under
 * `~/.local/share/thoremin/synthetic/` are not. Keep fixtures short (a few seconds).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [clipDir, name] = process.argv.slice(2);
if (!clipDir || !name) {
  console.error('usage: vite-node scripts/subframe/build_fixture.ts <clip dir> <fixture name>');
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'test', 'fixtures', name);
if (!existsSync(join(clipDir, 'truth.json'))) {
  console.error(`no truth.json in ${clipDir}`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });

interface Truth {
  schema: string;
  version: string;
  generator: unknown;
  spec: Record<string, unknown>;
  clip: Record<string, unknown>;
  objects: { name: string; impact_keypoint: string; keypoints: string[] }[];
  events: Record<string, unknown>[];
}
const truth = JSON.parse(readFileSync(join(clipDir, 'truth.json'), 'utf8')) as Truth;
const EVENT_KEYS = ['object', 'index', 'beat', 'amplitude', 't_grid', 't_impact', 'offset', 'kind', 't_peak_speed', 'peak_speed_px', 'fall', 'brake', 'impact_xy'];
const slim = {
  schema: truth.schema,
  version: truth.version,
  generator: truth.generator,
  spec: truth.spec,
  clip: truth.clip,
  objects: truth.objects.map((o) => ({ name: o.name, impact_keypoint: o.impact_keypoint, keypoints: o.keypoints })),
  events: truth.events.map((e) => {
    const s: Record<string, unknown> = {};
    for (const k of EVENT_KEYS) if (k in e) s[k] = e[k];
    const frames = e.frames as { lowest_error: number; nearest_error: number } | undefined;
    if (frames) s.frames = { lowest_error: frames.lowest_error, nearest_error: frames.nearest_error };
    return s;
  }),
};
writeFileSync(join(out, 'truth.json'), JSON.stringify(slim, null, 1) + '\n');
writeFileSync(join(out, 'keypoints.ndjson'), readFileSync(join(clipDir, 'keypoints.ndjson'), 'utf8'));
writeFileSync(
  join(out, 'meta.json'),
  JSON.stringify(
    {
      scenario: name,
      source: 'an.impacts',
      clip: basename(clipDir),
      spec: truth.spec,
      regenerate: 'an impacts clip <out> with the spec above (render off), then scripts/subframe/build_fixture.ts',
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
console.log(`${out}: ${slim.events.length} events, ${readFileSync(join(out, 'keypoints.ndjson'), 'utf8').split('\n').filter(Boolean).length} frames`);
