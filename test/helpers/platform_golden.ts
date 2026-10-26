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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

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
 * from the base, into this platform's override file (no file at all when nothing differs).
 */
export function writeGolden<T>(basePath: string, produced: Record<string, T>, platform: string = PLATFORM): string {
  if (platform === BASE_PLATFORM) {
    writeFileSync(basePath, JSON.stringify(produced, null, 1) + '\n');
    return basePath;
  }
  const base = JSON.parse(readFileSync(basePath, 'utf8')) as Record<string, T>;
  const differing = Object.fromEntries(Object.entries(produced).filter(([k, v]) => JSON.stringify(base[k]) !== JSON.stringify(v)));
  const path = overridePath(basePath, platform);
  writeFileSync(path, JSON.stringify(differing, null, 1) + '\n');
  return path;
}
