/**
 * A shell tool an extension contributes, as data (#330): React-free, so an extension's eager stub
 * and its pure modules can declare one without pulling React into a strict, React-less
 * typecheck. The panel that goes with it is `ExtensionTool` in `./types.ts`.
 */

/**
 * A shell tool an extension contributes, as data: the Tools launcher lists it (labelled and
 * described, one click from anywhere) and the player may pin it. The host validates it against
 * its own tool schema; an extension's tool always opens a panel.
 */
export interface ExtensionToolDecl {
  /** Stable id, unique across the app's tools and every extension's. */
  id: string;
  label: string;
  /** One line: the launcher row, the button's tooltip and the panel's strapline. */
  description: string;
  /** The launcher section: a `mode` takes the instrument over, a `tool` is used on it. */
  group: 'mode' | 'tool' | 'help';
  /** Whether it has its own bar button until the player says otherwise. */
  defaultPinned: boolean;
}
