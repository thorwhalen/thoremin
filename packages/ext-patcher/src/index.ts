/**
 * The patcher extension (#14, the v1 scope decided on #181): a shell tool that draws the LIVE
 * composed graph with React Flow, and a node inspector whose controls are the dials that feed the
 * node, written only by command dispatch. Read-only topology: no rewiring, no adding or removing
 * nodes, no saved `GraphSpec` (the v2 issue).
 *
 * A LAZY, tool-only extension (`docs/design/lazy-extensions.md` §6): it provides no node, owns no
 * dial and composes no branch, so this eager manifest is empty and opening the tool is the one
 * trigger that loads the React half and React Flow with it.
 */
import { defineExtension } from '@thoremin/sdk/instruments/extension';

export const PATCHER_EXTENSION_ID = 'patcher';

export const PATCHER_EXTENSION = defineExtension({
  id: PATCHER_EXTENSION_ID,
  provides: [],
  branches: [],
  dials: [] as const,
  derive: () => [],
});

export default PATCHER_EXTENSION;
