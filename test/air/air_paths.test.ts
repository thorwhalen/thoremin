/**
 * The air streams' names (#513): `extract.py` keeps `<id>.<stream>.ndjson.gz` (the
 * video-data rule) and the readers find it, or the pre-rule name where an old extraction
 * was never migrated, so a dataset built before the rule still reads.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { airDir, landmarksPath, streamPath } from '../../scripts/air/lib_air_paths';

function root(files: string[]): NodeJS.ProcessEnv {
  const env = { THOREMIN_DATA_DIR: mkdtempSync(join(tmpdir(), 'air-paths-')) };
  const dir = airDir('landmarks', 'guitar', env);
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f), '');
  return env;
}

describe('streamPath', () => {
  it('names the rule\'s gzipped stream when nothing exists yet', () => {
    const env = root([]);
    expect(streamPath('guitar', 'v1', 'hands', env)).toBe(join(airDir('landmarks', 'guitar', env), 'v1.hands.ndjson.gz'));
    expect(streamPath('guitar', 'v1', 'face.landmarks', env)).toBe(join(airDir('landmarks', 'guitar', env), 'v1.face.landmarks.ndjson.gz'));
  });

  it('prefers the rule\'s name over a pre-rule one', () => {
    const env = root(['v1.hands.ndjson.gz', 'v1.src.hands.ndjson']);
    expect(landmarksPath('guitar', 'v1', env)).toMatch(/v1\.hands\.ndjson\.gz$/);
  });

  it('falls back to the pre-rule names', () => {
    const env = root(['v1.src.hands.ndjson', 'v1.face.ndjson', 'v1.pose.ndjson']);
    expect(landmarksPath('guitar', 'v1', env)).toMatch(/v1\.src\.hands\.ndjson$/);
    expect(streamPath('guitar', 'v1', 'face', env)).toMatch(/v1\.face\.ndjson$/);
    expect(streamPath('guitar', 'v1', 'pose', env)).toMatch(/v1\.pose\.ndjson$/);
  });
});
