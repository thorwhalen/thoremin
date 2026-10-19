/**
 * The fold points: the only core files that may name the extension LISTS (`@/extensions`,
 * `@/app/extensions`). `test/extensions_boundary.test.ts` enforces it, and the architecture
 * ratchet (`test/architecture_ratchet.test.ts`, #600 S1) counts it. Since S3 every contribution is
 * folded once, in the contribution registry's two halves, so those are the only fold points: every
 * other core module reads the registry.
 */
export const FOLD_POINTS: ReadonlySet<string> = new Set([
  'src/host/contributions.ts', // the pure registry: nodes, branches, dials, transients, seeds, training, lazy nodes
  'src/app/host/contributions.ts', // the React registry: sections, tools, entry points, status hooks, mount effects
]);
