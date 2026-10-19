/**
 * The fold points: the only core files that may name the extension LISTS (`@/extensions`,
 * `@/app/extensions`). `test/extensions_boundary.test.ts` enforces it, and the architecture
 * ratchet (`test/architecture_ratchet.test.ts`, #600 S1) counts it: S3 folds every contribution
 * once, in one host-side registry, and this list shrinks to that registry plus the React list.
 */
export const FOLD_POINTS: ReadonlySet<string> = new Set([
  'src/nodes/browser.ts', // createAppRegistry
  'src/settings/schema.ts', // SettingsSchema = core + the extensions' dial slices
  'src/settings/dials.ts', // the dials form fields + the layer bijection
  'src/app/dials/instruments.ts', // the seeds: core's, then the extensions' instruments
  'src/app/training/routes.ts', // the extensions' training routes, then core's Trainer
  'src/app/graph.ts', // the full branch table, and the derivation and spec bound to it
  'src/app/dials/DialsControlsPanel.tsx', // the editor sections
  'src/app/dials/InstrumentsPanel.tsx', // the live readouts under the chosen row
  'src/app/useEngine.ts', // the status hooks
  'src/app/extensionLoad.ts', // loads a lazy extension's halves when a graph names its nodes
  'src/app/App.tsx', // the mount effects
  'src/app/extensions/index.ts', // the React-side list itself
  'src/app/shellTools.ts', // the shell's tools: core's, then the extensions' (#330)
  'src/app/ExtensionToolPanels.tsx', // the extensions' tool panels, in the shell's frame (#330)
  'src/app/entryPoints.ts', // the extensions' entry points into a tool from another's panel (#465)
]);
