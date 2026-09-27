/**
 * The virtual module `vite.extensions.ts` generates from `extensions.json`: the React
 * halves of the extensions this build ships.
 */
declare module 'virtual:thoremin/extensions-ui' {
  import type { ExtensionUi } from '@/app/extensions/types';
  const uis: readonly ExtensionUi[];
  export default uis;
}
