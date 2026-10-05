/**
 * GENERATED from extensions.json by `npm run extensions` (scripts/gen_extensions.ts); do not edit.
 *
 * The virtual module `vite.extensions.ts` generates: the pure manifests of the extensions this
 * build ships, typed as a tuple of each listed manifest's own type, so the `Settings` type is
 * computed from the manifests (`src/settings/schema.ts`) without core importing an extension.
 * (The React halves' module is declared next to their list, in `src/app/extensions/virtual.d.ts`,
 * so that the strict, React-free typecheck never reads a React type.)
 */
declare module 'virtual:thoremin/extensions' {
  const extensions: readonly [typeof import("@/extensions/air").default];
  export default extensions;
}
