/**
 * The virtual module `vite.extensions.ts` generates from `extensions.json`: the React
 * halves of the extensions this build ships.
 */
declare module 'virtual:thoremin/extensions-ui' {
  import type { ExtensionUi, ExtensionUiStub } from '@thoremin/sdk-ui/types';
  /** An eager extension's React half, or a lazy one's stub with the `load` the build generated. */
  const uis: readonly (ExtensionUi | (ExtensionUiStub & { load: () => Promise<ExtensionUi> }))[];
  export default uis;
}
