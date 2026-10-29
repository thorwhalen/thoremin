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
  const extensions: readonly [typeof import("@thoremin/ext-air").default, typeof import("@thoremin/ext-harmony").default, typeof import("@thoremin/ext-asl").default, typeof import("@thoremin/ext-draw").default, typeof import("@/slices/midi").default, typeof import("@/slices/generative").default, typeof import("@/slices/song").default, typeof import("@/slices/body").default, typeof import("@/slices/trainer").default, typeof import("@/slices/conductor").default, typeof import("@/slices/lab").default, typeof import("@/slices/theremin").default, typeof import("@/slices/sound-mapper").default, typeof import("@/slices/games").default, typeof import("@thoremin/ext-faces").default, typeof import("@thoremin/ext-patcher").default];
  export default extensions;
}
