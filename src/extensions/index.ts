/**
 * The extensions this build ships, as data (seam 4 of the instruments-as-graphs ADR: an
 * in-tree array of manifests; the replacement already pointed at is a build-time
 * `extensions.json` naming registry packages, PR 6). Every registry the app used to
 * hand-list is a fold over this array: `createAppRegistry`, `ALL_BRANCHES`,
 * `SettingsSchema`, the dials form, `store-controls`' ports, `branchIdsFor` (all bound in
 * `src/app/graph.ts` and the other fold points, never in the pure `src/instruments`).
 *
 * Pure: the React halves are listed in `src/app/extensions`.
 */
import type { Extension } from '@/instruments/extension';
import { AIR_EXTENSION } from './air';

export const EXTENSIONS: readonly Extension[] = [AIR_EXTENSION];

/** Every extension's dial slices, in extension order (what the settings schema spreads). */
export const EXTENSION_DIAL_SLICES = EXTENSIONS.flatMap((e) => e.dials);

/** Every extension's branch, in extension order. */
export const EXTENSION_BRANCHES = EXTENSIONS.flatMap((e) => e.branches);
