/**
 * The faces extension's deferred node half: none. It is a tool-only extension (#330 P2); a
 * categorizer node for the instruments is P4's. Kept so the `lazy` entry has both halves.
 */
import type { ExtensionNodes } from '@thoremin/sdk/instruments/extension';

const FACES_NODES: ExtensionNodes = { nodes: [] };

export default FACES_NODES;
