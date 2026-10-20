/**
 * The patcher's deferred node half: none. A tool-only lazy extension still names one (the host
 * loads `{ nodes }` for every lazy entry), so it is the empty list.
 */
import type { ExtensionNodes } from '@thoremin/sdk/instruments/extension';

const PATCHER_NODES: ExtensionNodes = { nodes: [] };

export default PATCHER_NODES;
