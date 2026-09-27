/**
 * The extensions this build ships, as data (seam 4 of the instruments-as-graphs ADR):
 * `extensions.json` names them and `vite.extensions.ts` injects them at build time as a
 * virtual module, so the deploy chooses the set; after the repository split the same file
 * names registry packages. Every registry the app used to
 * hand-list is a fold over this array: `createAppRegistry`, `ALL_BRANCHES`,
 * `SettingsSchema`, the dials form, `store-controls`' ports, `branchIdsFor` (all bound in
 * `src/app/graph.ts` and the other fold points, never in the pure `src/instruments`).
 *
 * Pure: the React halves are listed in `src/app/extensions`.
 */
import type { Extension } from '@/instruments/extension';
import listed from 'virtual:thoremin/extensions';

/** The extensions `extensions.json` names, in its order (injected at build time). */
export const EXTENSIONS: readonly Extension[] = listed;

/** Every extension's dial slices, in extension order (what the settings schema spreads). */
export const EXTENSION_DIAL_SLICES = EXTENSIONS.flatMap((e) => e.dials);

/** Every extension's branch, in extension order. */
export const EXTENSION_BRANCHES = EXTENSIONS.flatMap((e) => e.branches);
