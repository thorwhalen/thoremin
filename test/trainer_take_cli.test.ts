/**
 * The converter CLI is REACHABLE (#160 / #163).
 *
 * This exists because it was not. The first version of the converter put the logic and
 * the CLI in one module and guarded the entry point with
 * `if (process.argv[1]?.includes('trainer_take_to_fixture'))`. Under `vite-node` — the
 * documented way to run it — `argv[1]` is `node_modules/.bin/vite-node` and the script's
 * own path never appears in `argv` at all, so the guard was always false. The documented
 * command printed nothing and exited 0.
 *
 * Every unit test of the conversion logic passed throughout, because they import
 * `convertTake` directly. That is precisely the gap CLAUDE.md's "a feature nobody can
 * find is not shipped" rule names, and the only check that closes it is running the
 * documented command as documented.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STEM = 'trainer-2026-09-05T10-00-00';
const T0 = 1000;

/** A minimal but schema-faithful take on disk. */
function makeTake(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cli-take-'));
  const ann = [
    JSON.stringify({ anchor: true, t: T0, clock: 'media', wallClockISO: '2026-09-05T10:00:00.000Z', recStartPerf: 1e6, session: STEM, schema: 'thoremin.annotations/1' }),
    JSON.stringify({ t: T0 + 1, tCorrected: T0 + 1, tag: 'cue:look-left', status: 'open', seq: 0, clock: 'media', src: 'auto' }),
    JSON.stringify({ t: T0 + 3, tCorrected: T0 + 3, tag: 'cue:look-left', status: 'close', seq: 1, clock: 'media', src: 'auto' }),
  ];
  writeFileSync(join(dir, `${STEM}.annotations.jsonl`), ann.join('\n') + '\n');
  const feats = Array.from({ length: 20 }, (_, i) =>
    JSON.stringify({ tick: i, t: T0 + 1 + i * 0.05, key: 'faceVec.vector', value: { 'face.head.yaw': -20 + i } }),
  );
  writeFileSync(join(dir, `${STEM}.features.jsonl`), feats.join('\n') + '\n');
  writeFileSync(join(dir, `${STEM}.manifest.json`), JSON.stringify({ t0: T0, fps: 30, streams: [] }));
  return dir;
}

/** Run the CLI exactly as the docs say to, and return its stdout. */
function runCli(args: string[]): string {
  return execFileSync(
    'npx',
    ['vite-node', 'scripts/trainer_take_to_fixture.ts', '--', ...args],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

describe('the documented CLI invocation actually runs', () => {
  it('produces a report on a real take, rather than silently doing nothing', () => {
    const out = runCli([makeTake(), 'cli_reachability_probe', '--dry-run']);
    // The specific regression: the old entry guard made this string empty.
    expect(out.trim()).not.toBe('');
    expect(out).toContain('[dry run] would write');
    expect(out).toContain(STEM);
    expect(out).toContain('look-left');
    expect(out).toContain('faceVec.vector');
  }, 60_000);

  it('a dry run writes nothing, so this test cannot leave a fixture behind', () => {
    runCli([makeTake(), 'cli_reachability_probe', '--dry-run']);
    expect(existsSync(join(ROOT, 'test', 'fixtures', 'cli_reachability_probe'))).toBe(false);
  }, 60_000);

  it('exits non-zero with usage when given no arguments', () => {
    let code = 0;
    try {
      execFileSync('npx', ['vite-node', 'scripts/trainer_take_to_fixture.ts'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      code = (err as { status?: number }).status ?? 0;
    }
    expect(code).toBe(2);
  }, 60_000);
});
