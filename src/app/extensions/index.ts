/**
 * The React halves of the extensions this build ships, in the same order as `EXTENSIONS`
 * (`src/extensions`). `DialsControlsPanel` folds over their panels, `useEngine` over their
 * status hooks, `App` over their mount effects.
 */
import type { ExtensionUi } from './types';
import listed from 'virtual:thoremin/extensions-ui';

/** The React halves of the extensions `extensions.json` names, in its order. */
export const EXTENSION_UIS: readonly ExtensionUi[] = listed;

export const EXTENSION_PANELS = EXTENSION_UIS.flatMap((u) => u.panels);
export const EXTENSION_STATUS_HOOKS = EXTENSION_UIS.flatMap((u) => u.statusHooks);
export const EXTENSION_MOUNT_EFFECTS = EXTENSION_UIS.flatMap((u) => u.onMount);
