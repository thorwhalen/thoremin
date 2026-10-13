/**
 * The faces extension's React half, EAGER STUB: the shell tool it contributes, as data, so the
 * Tools launcher lists it before anything loads. The panel is `./lazy_ui.tsx`, loaded the first
 * time the tool opens (`docs/design/lazy-extensions.md`). No React import: it is data.
 */
import type { ExtensionUiStub } from '@thoremin/sdk-ui/types';
import type { ExtensionToolDecl } from '@thoremin/sdk-ui/tools';

/** The face session's shell tool, as data (the deferred half `./lazy_ui.tsx` adds its panel). */
export const FACES_TOOL: ExtensionToolDecl = {
  id: 'faces',
  label: 'Your faces',
  description: 'Record your own faces and carve them into categories you name and keep: the face categorizer.',
  group: 'mode',
  defaultPinned: false,
};

export const FACES_UI_STUB: ExtensionUiStub = {
  id: 'faces',
  panels: [],
  tools: [FACES_TOOL],
};

export default FACES_UI_STUB;
