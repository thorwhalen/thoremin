import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsonCloseTo, overridePath, overrideProblems, readGolden, writeGolden } from './helpers/platform_golden';

const setup = (base: object) => {
  const dir = mkdtempSync(join(tmpdir(), 'golden-'));
  const path = join(dir, 'g.json');
  writeFileSync(path, JSON.stringify(base));
  return path;
};

describe('platform goldens', () => {
  it('the base platform reads and writes the base file', () => {
    const p = setup({ a: 1, b: 2 });
    writeGolden(p, { a: 1, b: 3 }, 'linux-x64');
    expect(readGolden(p, 'linux-x64')).toEqual({ a: 1, b: 3 });
    expect(existsSync(overridePath(p, 'linux-x64'))).toBe(false);
  });

  it('another platform writes only what differs, reads base plus override', () => {
    const p = setup({ a: 1, b: 2 });
    writeGolden(p, { a: 1, b: 9 }, 'darwin-arm64');
    expect(JSON.parse(readFileSync(overridePath(p, 'darwin-arm64'), 'utf8'))).toEqual({ b: 9 });
    expect(readGolden(p, 'darwin-arm64')).toEqual({ a: 1, b: 9 });
    expect(readGolden(p, 'linux-x64')).toEqual({ a: 1, b: 2 });
  });

  it('a partial run keeps the other override entries; an entry back at the base is dropped; nothing left removes the file', () => {
    const p = setup({ a: 1, b: 2, c: 3 });
    writeGolden(p, { a: 10, b: 20, c: 3 }, 'darwin-arm64');
    writeGolden(p, { a: 11 }, 'darwin-arm64'); // only `a` re-run
    expect(JSON.parse(readFileSync(overridePath(p, 'darwin-arm64'), 'utf8'))).toEqual({ a: 11, b: 20 });
    writeGolden(p, { a: 1, b: 2 }, 'darwin-arm64'); // both back at the base
    expect(existsSync(overridePath(p, 'darwin-arm64'))).toBe(false);
  });

  it('flags override entries that are orphaned or equal to the base', () => {
    const p = setup({ a: 1, b: 2 });
    writeFileSync(overridePath(p, 'darwin-arm64'), JSON.stringify({ a: 1, z: 5, b: 3 }));
    expect(overrideProblems(p, 'darwin-arm64')).toEqual(['a: equals the base, drop it', 'z: not in the base golden']);
  });
});

describe('jsonCloseTo', () => {
  it('numbers to a relative tolerance, key order and everything else exact', () => {
    expect(jsonCloseTo({ a: 35.0920220420889, b: [1, 2] }, { a: 35.092022042088914, b: [1, 2] })).toBe(true);
    expect(jsonCloseTo({ a: 1 }, { a: 1.000001 })).toBe(false);
    expect(jsonCloseTo({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false); // layout is a contract
    expect(jsonCloseTo({ a: 12345678901 }, { a: 12345678900 })).toBe(false); // integers are not rounded away
    expect(jsonCloseTo('x', 'x')).toBe(true);
    expect(jsonCloseTo([1], [1, 2])).toBe(false);
  });
});
