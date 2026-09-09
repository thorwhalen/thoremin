/**
 * Every repo path CLAUDE.md names must exist.
 *
 * CLAUDE.md's "Where things live" table is the map a fresh agent navigates by, and a row
 * pointing at a deleted file is worse than no row: it sends someone looking for a module
 * that moved, and it reads as authoritative. It happens by omission — you delete a module
 * in a PR about something else and the map is not part of the diff. It happened in #189,
 * which removed `src/app/engineLoop.ts` and left the row behind.
 *
 * The check is deliberately dumb: extract every backticked `src|test|scripts|docs/...`
 * path and assert it resolves. That is enough to catch the whole class, and it costs
 * nothing to keep true.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Paths CLAUDE.md names in order to say they do NOT exist.
 *
 * `src/music/instruments.ts` is the one: the "sound vs instrument" section exists because
 * both words were taken, and it says plainly *"There is no `src/music/instruments.ts`. If
 * you are looking for the timbre enum, it is `src/music/sounds.ts`."* A path audit that
 * "fixed" that by creating the file, or by deleting the sentence, would destroy the
 * warning. Listed here so the exception is explicit rather than a silent regex hole.
 */
const DELIBERATELY_ABSENT = new Set(['src/music/instruments.ts']);

function citedPaths(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/`((?:src|test|scripts|docs)\/[A-Za-z0-9_./-]+)`/g)) {
    const p = m[1];
    // Trailing punctuation inside the backticks, and directory citations, are fine.
    out.add(p.replace(/[.,]$/, ''));
  }
  return [...out].sort();
}

describe('CLAUDE.md is a map you can navigate by', () => {
  const md = readFileSync(resolve(ROOT, 'CLAUDE.md'), 'utf8');
  const cited = citedPaths(md);

  it('cites a meaningful number of paths (the extractor still works)', () => {
    // Guards the guard: a regex that silently matched nothing would make every
    // assertion below vacuously true.
    expect(cited.length).toBeGreaterThan(30);
  });

  it('every path it names exists, except the ones it names to say they do not', () => {
    const missing = cited.filter((p) => !DELIBERATELY_ABSENT.has(p) && !existsSync(resolve(ROOT, p)));
    expect(missing, `CLAUDE.md points at paths that do not exist:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('the deliberate absences are still absent — the warning is only useful while true', () => {
    for (const p of DELIBERATELY_ABSENT) {
      expect(existsSync(resolve(ROOT, p)), `${p} now exists; CLAUDE.md says it does not`).toBe(false);
    }
  });
});
