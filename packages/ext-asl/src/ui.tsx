/**
 * The ASL extension's React half, EAGER STUB: only the editor section it will contribute
 * (which instrument, under what label), so the shell can list it before anything loads. The
 * section's components and the status hook are `./lazy_ui.tsx`, loaded on demand
 * (`docs/design/lazy-extensions.md`). No React import: it is data.
 */
import type { ExtensionUiStub } from '@thoremin/sdk-ui/types';

export const ASL_UI_STUB: ExtensionUiStub = {
  id: 'asl',
  panels: [{ instrumentId: 'asl', section: 'Sign language' }],
};

export default ASL_UI_STUB;
