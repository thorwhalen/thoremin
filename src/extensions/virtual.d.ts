/**
 * The virtual module `vite.extensions.ts` generates from `extensions.json`: the pure
 * manifests of the extensions this build ships, as data the deploy chooses. (The React
 * halves' module is declared next to their list, in `src/app/extensions/virtual.d.ts`, so
 * that the strict, React-free typecheck never reads a React type.)
 */
declare module 'virtual:thoremin/extensions' {
  import type { Extension } from '@/instruments/extension';
  const extensions: readonly Extension[];
  export default extensions;
}
