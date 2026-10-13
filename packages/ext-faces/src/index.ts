/**
 * The faces extension (#330): personal facial-expression categorizers. A player records a take
 * of their own faces, the take is carved into categories (as many as they choose, neutral
 * counted or set aside), each shown by its faces and named (defaults from the general
 * expression model, one-to-one), and several are saved. Phase P2 of #330 is this session; using
 * a saved categorizer in an instrument is P4.
 *
 * LAZY and TOOL-ONLY (`docs/design/lazy-extensions.md`): this file is the eager stub. It ships no
 * node, no dial and no branch; its React tool is declared by `./ui.tsx` and its code
 * (`./lazy_ui.tsx`: the session, the carving, the panel) loads the first time the player opens
 * the tool.
 */
import { defineExtension } from '@thoremin/sdk/instruments/extension';

export const FACES_EXTENSION = defineExtension({
  id: 'faces',
  // No node types: the deferred half is the tool (`./lazy.ts` provides an empty list).
  provides: [],
  branches: [],
  dials: [] as const,
  derive: () => [],
});

export default FACES_EXTENSION;
