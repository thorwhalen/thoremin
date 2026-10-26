/**
 * Byte-identical goldens and the platform they were recorded on (#828).
 *
 * A digest of a long numeric stream is only as portable as the arithmetic under it. The goldens
 * here were recorded on CI's linux-x64; on arm64 (an Apple-silicon Mac) V8's `Math` functions
 * can differ in the last bit for some inputs (the same failures appear under Node 20 and 23, so
 * it is the architecture, not the Node version), and the digest moves with it. Rather than loosen
 * a byte-identical check into a tolerance (which would stop it catching the small behaviour change
 * it exists for), a platform whose numbers differ keeps its OWN golden next to the base one,
 * holding only the entries that differ: `name.darwin-arm64.json` beside `name.json`. The base file
 * stays the CI platform's; an entry missing from an override falls back to it.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

/** The platform whose goldens are the base files: where CI runs. */
export const BASE_PLATFORM = 'linux-x64';
export const PLATFORM = `${process.platform}-${process.arch}`;

/** The override file for `platform` beside the base golden `basePath`. */
export const overridePath = (basePath: string, platform: string = PLATFORM): string => basePath.replace(/\.json$/, `.${platform}.json`);

/** The base golden with this platform's overrides laid over it. */
export function readGolden<T>(basePath: string, platform: string = PLATFORM): Record<string, T> {
  const base = JSON.parse(readFileSync(basePath, 'utf8')) as Record<string, T>;
  const path = overridePath(basePath, platform);
  if (platform === BASE_PLATFORM || !existsSync(path)) return base;
  return { ...base, ...(JSON.parse(readFileSync(path, 'utf8')) as Record<string, T>) };
}

/**
 * Record `produced`: the base file on the base platform; elsewhere only the entries that differ
 * from the base go into this platform's override file. Entries of the existing override for
 * scenarios NOT in `produced` are kept (a partial run, `vitest -t`, must not delete the rest);
 * one that now equals the base is dropped, and the file is removed when nothing differs.
 */
export function writeGolden<T>(basePath: string, produced: Record<string, T>, platform: string = PLATFORM): string {
  if (platform === BASE_PLATFORM) {
    writeFileSync(basePath, JSON.stringify(produced, null, 1) + '\n');
    return basePath;
  }
  const base = JSON.parse(readFileSync(basePath, 'utf8')) as Record<string, T>;
  const path = overridePath(basePath, platform);
  const kept = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, T>) : {};
  for (const [k, v] of Object.entries(produced)) {
    if (JSON.stringify(base[k]) !== JSON.stringify(v)) kept[k] = v;
    else delete kept[k];
  }
  if (Object.keys(kept).length === 0) rmSync(path, { force: true });
  else writeFileSync(path, JSON.stringify(kept, null, 1) + '\n');
  return path;
}

/** Every override entry must name a base entry and differ from it: a stale one would mask the base. */
export function overrideProblems<T>(basePath: string, platform: string = PLATFORM): string[] {
  const path = overridePath(basePath, platform);
  if (!existsSync(path)) return [];
  const base = JSON.parse(readFileSync(basePath, 'utf8')) as Record<string, T>;
  const override = JSON.parse(readFileSync(path, 'utf8')) as Record<string, T>;
  return Object.entries(override).flatMap(([k, v]) => (!(k in base) ? [`${k}: not in the base golden`] : JSON.stringify(base[k]) === JSON.stringify(v) ? [`${k}: equals the base, drop it`] : []));
}

/**
 * Are two parsed JSON values equal, numbers to a relative tolerance and key ORDER exactly? For
 * data whose last bits are platform noise (a trained weight) but whose layout is a contract.
 */
export function jsonCloseTo(a: unknown, b: unknown, rel: number = 1e-12): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b || Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonCloseTo(v, b[i], rel));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && jsonCloseTo((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], rel));
  }
  return a === b;
}
