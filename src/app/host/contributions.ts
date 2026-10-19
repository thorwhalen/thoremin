/**
 * The contribution registry, React half (#600 S3; `docs/design/vertical-slices.md` §4.2): the ONE
 * place the shell folds what the listed extensions contribute to the UI: editor sections, shell
 * tools and their panels (and a detached tool's stop control), entry points between tools and
 * sections in another tool's panel (#600 S15), status hooks, mount effects, keybindings and
 * the extensions' commands (#600 S11, registered into the app's command registry). Every shell
 * module reads them from here, never from the list (`src/app/extensions`), which keeps the
 * loading machinery for lazy halves. Its pure twin is `src/host/contributions.ts`.
 *
 * The keyed points are checked once, here (with the pure rule `checkUiDecls`, so it is tested
 * without React): a tool id, an entry point id or an editor section (instrument and section
 * label) declared twice is refused with both extensions named. Core's own tools are checked
 * against the extensions' where both are known (`src/app/shellTools.ts`).
 */
import type { ExtensionCommand, ExtensionPanel, ExtensionToolDecl, ExtensionToolSection, KeybindingDecl, StillSounding, ToolDetached, ToolEntryPointDecl } from '@thoremin/sdk-ui/types';
import { defineCommand, err, type Registry } from 'acture';
import {
  EXTENSION_COMMANDS,
  EXTENSION_ENTRY_POINTS,
  EXTENSION_KEYBINDINGS,
  EXTENSION_MOUNT_EFFECTS,
  EXTENSION_PANELS,
  EXTENSION_STILL_SOUNDING,
  EXTENSION_TOOL_DECLS,
  EXTENSION_TOOL_DETACHED,
  EXTENSION_TOOL_ICONS,
  EXTENSION_TOOL_PANELS,
  EXTENSION_TOOL_SECTIONS,
  EXTENSION_UI_DECLS,
  EXTENSION_UI_IDS,
  extensionStatusHooks,
  loadExtensionUi,
  makeExtensionSinks,
} from '@/app/extensions';

import { checkUiDecls, CONTRIBUTIONS } from '@/host/contributions';
import { registry } from '@/app/commands/registry';
import { declareDialWritingCommands } from '@/app/commands/confirmation';

export { extensionStatusHooks, loadExtensionUi, makeExtensionSinks };

/** The UI contributions, folded once and checked. */
export interface UiContributions {
  /** Every extension's id, eager or lazy, in `extensions.json`'s order. */
  ids: readonly string[];
  panels: readonly ExtensionPanel[];
  toolDecls: readonly (ExtensionToolDecl & { runsDetached?: true })[];
  toolPanels: typeof EXTENSION_TOOL_PANELS;
  /** The tools that keep working with their panel closed (#600 S15): the bar's running mark and stop. */
  toolDetached: readonly { id: string; detached: ToolDetached }[];
  /** The extension tools' icons (#600 S15), by tool id. */
  toolIcons: typeof EXTENSION_TOOL_ICONS;
  /** Sections contributed to another tool's panel (#600 S15). */
  toolSections: readonly ExtensionToolSection[];
  entryPoints: readonly ToolEntryPointDecl[];
  mountEffects: typeof EXTENSION_MOUNT_EFFECTS;
  keybindings: readonly KeybindingDecl[];
  /** What keeps sounding while the player has muted (#600 S13), named on the muted banner. */
  stillSounding: readonly StillSounding[];
}

checkUiDecls(EXTENSION_UI_DECLS);

export const UI_CONTRIBUTIONS: UiContributions = {
  ids: EXTENSION_UI_IDS,
  panels: EXTENSION_PANELS,
  toolDecls: EXTENSION_TOOL_DECLS,
  toolPanels: EXTENSION_TOOL_PANELS,
  toolDetached: EXTENSION_TOOL_DETACHED,
  toolIcons: EXTENSION_TOOL_ICONS,
  toolSections: EXTENSION_TOOL_SECTIONS,
  entryPoints: EXTENSION_ENTRY_POINTS,
  mountEffects: EXTENSION_MOUNT_EFFECTS,
  keybindings: EXTENSION_KEYBINDINGS,
  stillSounding: EXTENSION_STILL_SOUNDING,
};

/**
 * Register every extension command (#600 S11) into `target`: an eager extension's implementation
 * as it is; for a command a manifest DECLARES (a lazy extension's, listed before its code loads),
 * a stand-in under the same id, title, description and parameters that loads the extension's React
 * half when the command runs and hands the call to its implementation. So the palette, the
 * assistant and a saved binding see the command at once, and its id is the one ever shipped.
 * Idempotent: an id already registered is left alone. Exported for direct testing.
 */
export function registerExtensionCommands(target: Registry): void {
  // Implemented now: an eager extension's commands, and those a lazy one's stub carries.
  const eager = new Map<string, ExtensionCommand>(EXTENSION_COMMANDS.map((c) => [c.id, c] as const));
  for (const { extension, decl } of CONTRIBUTIONS.commandDecls) {
    if (target.has(decl.id)) continue;
    const ready = eager.get(decl.id);
    if (ready) {
      target.register(ready as never);
      continue;
    }
    target.register(
      defineCommand({
        id: decl.id,
        title: decl.title,
        description: decl.description,
        category: decl.category,
        params: decl.params,
        execute: async (params, ctx) => {
          const ui = await loadExtensionUi(extension);
          const impl = ui.commands?.find((c) => c.id === decl.id);
          if (!impl) return err('not_provided', `the "${extension}" extension declares "${decl.id}" but provides no implementation`);
          return (impl.execute as (p: unknown, c: unknown) => ReturnType<typeof err>)(params, ctx);
        },
      }),
    );
  }
  // An eager extension's command it did not declare is still registered (declaring is what lists
  // a LAZY extension's commands early; an eager one's code is already here).
  for (const [id, c] of eager) if (!target.has(id)) target.register(c as never);
}

// The app's registry gets them when this registry of contributions loads: every shell module that
// lists or dispatches commands imports it.
registerExtensionCommands(registry);
// The extension commands that write the dials (#600 S14): undo takes them back.
declareDialWritingCommands([...EXTENSION_COMMANDS.filter((c) => c.writesDials).map((c) => c.id), ...CONTRIBUTIONS.commandDecls.filter((d) => d.decl.writesDials).map((d) => d.decl.id)]);
