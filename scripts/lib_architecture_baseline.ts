/**
 * The architecture ratchet's baseline (#600 S1): reading it, measuring the tree against it, and
 * comparing the two. Shared by the gate (`test/architecture_ratchet.test.ts`) and the CLI
 * (`scripts/architecture_ratchet.ts`).
 *
 * The rule is the React type ratchet's (`scripts/react_type_ratchet.ts`): a structural number
 * that GREW fails, and one that SHRANK fails too, as a stale baseline, until the PR that lowered
 * it runs `npm run ratchet:arch -- --update` and commits the result, so the baseline only moves
 * down. The file-size ceilings are the exception: a smaller file passes without a re-baseline,
 * since file sizes move with every edit; a bigger one fails.
 */
import { readFileSync } from 'node:fs';
import type { Extension } from '@thoremin/sdk/instruments/extension';
import { readExtensionEntries } from '../vite.extensions';
import { FOLD_POINTS } from '../test/helpers/fold_points';
import { extensionNames, measure, type ArchitectureNumbers, type Measured } from './lib_architecture';

export const BASELINE_FILE = 'test/architecture.baseline.json';

export type Baseline = { '//': string } & ArchitectureNumbers;

export function readBaseline(file = BASELINE_FILE): Baseline {
  return JSON.parse(readFileSync(file, 'utf8')) as Baseline;
}

/** The SHIPPED extensions' manifests (`extensions.json`, whatever `THOREMIN_EXTENSIONS` says):
 *  the names core must not spell out are those of what ships. */
export async function shippedManifests(manifest = 'extensions.json'): Promise<Extension[]> {
  const out: Extension[] = [];
  for (const entry of readExtensionEntries(manifest)) {
    const mod = (await import(/* @vite-ignore */ entry.module)) as { default: Extension };
    out.push(mod.default);
  }
  return out;
}

export async function measureNow(baseline?: Baseline): Promise<Measured> {
  const manifests = await shippedManifests();
  return measure({
    root: process.cwd(),
    extensions: manifests.map(extensionNames),
    foldPoints: FOLD_POINTS.size,
    largestFiles: baseline ? Object.keys(baseline.largestFiles) : undefined,
  });
}

export function compareToBaseline(baseline: ArchitectureNumbers, now: ArchitectureNumbers): { grew: string[]; shrank: string[] } {
  const grew: string[] = [];
  const shrank: string[] = [];
  const scalar = (name: string, was: number, is: number): void => {
    if (is > was) grew.push(`${name}: ${was} -> ${is}`);
    else if (is < was) shrank.push(`${name}: ${was} -> ${is}`);
  };
  for (const key of ['nodeImplementationImports', 'storeControlsPorts', 'useEngineReporters', 'foldPoints', 'importCycles', 'runtimeImportCycles'] as const) {
    scalar(key, baseline[key], now[key]);
  }
  const ids = new Set([...Object.keys(baseline.extensionNamesInCore), ...Object.keys(now.extensionNamesInCore)]);
  for (const id of [...ids].sort()) scalar(`extensionNamesInCore.${id}`, baseline.extensionNamesInCore[id] ?? 0, now.extensionNamesInCore[id] ?? 0);
  for (const [file, ceiling] of Object.entries(baseline.largestFiles)) {
    const is = now.largestFiles[file] ?? 0;
    if (is > ceiling) grew.push(`largestFiles["${file}"]: ${ceiling} -> ${is} lines (split it rather than grow it)`);
  }
  return { grew, shrank };
}
