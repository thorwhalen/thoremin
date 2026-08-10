/**
 * Access to the committed replay fixtures — the one place that knows where they live
 * and how to load one.
 *
 * The fixtures are per-edge NDJSON recordings under `test/fixtures/<scenario>/`, either
 * synthetic (recorded by `npm run record`) or derived from real video (decoded once with
 * MediaPipe; see docs/TESTING.md). Six test files had each re-derived this path and its
 * loader; they now all import from here.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { valuesFromNDJSON } from '@/dag';

/** The committed-fixtures root (`test/fixtures`). */
export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/**
 * Load one recorded edge stream: `test/fixtures/<scenario>/<key>.ndjson` → its values.
 * Large video-derived streams may instead be committed gzipped (`<key>.ndjson.gz`,
 * e.g. the 478-point face mesh) — the fallback decompresses transparently, so tests
 * always address a stream by its logical key. Throws (rather than silently yielding
 * an empty stream) when the fixture is missing, so a stale checkout fails loudly
 * with the way to regenerate it.
 */
export function loadStream(scenario: string, key: string): unknown[] {
  const path = join(FIXTURES, scenario, `${key}.ndjson`);
  if (existsSync(path)) return valuesFromNDJSON(readFileSync(path, 'utf8'));
  const gzPath = `${path}.gz`;
  if (existsSync(gzPath)) {
    try {
      return valuesFromNDJSON(gunzipSync(readFileSync(gzPath)).toString('utf8'));
    } catch (err) {
      // A present-but-corrupt/truncated .gz (e.g. a partially synced checkout)
      // must fail as loudly as a missing one — a bare zlib error names neither
      // the file nor the fix.
      throw new Error(
        `corrupt fixture ${gzPath} (${err instanceof Error ? err.message : String(err)}) — regenerate it (see docs/TESTING.md)`,
      );
    }
  }
  throw new Error(`missing fixture ${path} — regenerate it (\`npm run record\`; see docs/TESTING.md)`);
}
