/**
 * The faces extension's deferred node half (#330 P4): the personal categorizer node, loaded the
 * first time a composed graph names `face-categorizer` (an instrument whose face chords read one
 * of the player's categorizers).
 */
import type { NodeDef } from '@thoremin/dag';
import type { ExtensionNodes } from '@thoremin/sdk/instruments/extension';
import { faceCategorizerNode } from './nodes/face_categorizer';

const FACES_NODES: ExtensionNodes = { nodes: [faceCategorizerNode] as unknown as NodeDef<unknown>[] };

export default FACES_NODES;
