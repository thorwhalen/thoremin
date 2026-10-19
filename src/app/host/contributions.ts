/**
 * The contribution registry, React half (#600 S3; `docs/design/vertical-slices.md` §4.2): the ONE
 * place the shell folds what the listed extensions contribute to the UI: editor sections, shell
 * tools and their panels, entry points between tools, status hooks and mount effects. Every shell
 * module reads them from here, never from the list (`src/app/extensions`), which keeps the
 * loading machinery for lazy halves. Its pure twin is `src/host/contributions.ts`.
 *
 * The keyed points are checked once, here (with the pure rule `checkUiDecls`, so it is tested
 * without React): a tool id, an entry point id or an editor section (instrument and section
 * label) declared twice is refused with both extensions named. Core's own tools are checked
 * against the extensions' where both are known (`src/app/shellTools.ts`).
 */
import type { ExtensionPanel, ExtensionToolDecl, ToolEntryPointDecl } from '@thoremin/sdk-ui/types';
import {
  EXTENSION_ENTRY_POINTS,
  EXTENSION_MOUNT_EFFECTS,
  EXTENSION_PANELS,
  EXTENSION_TOOL_DECLS,
  EXTENSION_TOOL_PANELS,
  EXTENSION_UI_DECLS,
  EXTENSION_UI_IDS,
  extensionStatusHooks,
  loadExtensionUi,
  makeExtensionSinks,
} from '@/app/extensions';

import { checkUiDecls } from '@/host/contributions';

export { extensionStatusHooks, loadExtensionUi, makeExtensionSinks };

/** The UI contributions, folded once and checked. */
export interface UiContributions {
  /** Every extension's id, eager or lazy, in `extensions.json`'s order. */
  ids: readonly string[];
  panels: readonly ExtensionPanel[];
  toolDecls: readonly ExtensionToolDecl[];
  toolPanels: typeof EXTENSION_TOOL_PANELS;
  entryPoints: readonly ToolEntryPointDecl[];
  mountEffects: typeof EXTENSION_MOUNT_EFFECTS;
}

checkUiDecls(EXTENSION_UI_DECLS);

export const UI_CONTRIBUTIONS: UiContributions = {
  ids: EXTENSION_UI_IDS,
  panels: EXTENSION_PANELS,
  toolDecls: EXTENSION_TOOL_DECLS,
  toolPanels: EXTENSION_TOOL_PANELS,
  entryPoints: EXTENSION_ENTRY_POINTS,
  mountEffects: EXTENSION_MOUNT_EFFECTS,
};
