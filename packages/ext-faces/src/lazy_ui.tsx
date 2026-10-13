/**
 * The faces extension's React half, DEFERRED: the face session tool's panel (and through it the
 * session, the carving, the stills and the saved collection). Loaded by the host's build with a
 * dynamic `import()` (`extensions.json`'s `lazy.ui`) the first time the player opens the tool, so
 * none of it is in the main chunk (`docs/design/lazy-extensions.md`).
 */
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import FaceSessionPanel from './panels/FaceSessionPanel';
import { FACES_TOOL } from './ui';

export const FACES_UI: ExtensionUi = {
  id: 'faces',
  panels: [],
  statusHooks: [],
  onMount: [],
  tools: [{ ...FACES_TOOL, Panel: FaceSessionPanel }],
};

export default FACES_UI;
