/**
 * The faces extension's deferred node half: the personal categorizer nodes, loaded the first time
 * a composed graph names one: `face-categorizer` (#330 P4, an instrument whose face chords read
 * one of the player's categorizers) or `pose-categorizer` (#384, one that plays a saved pose
 * categorizer).
 */
import type { NodeDef } from '@thoremin/dag';
import type { ExtensionNodes } from '@thoremin/sdk/instruments/extension';
import { faceCategorizerNode } from './nodes/face_categorizer';
import { poseCategorizerNode } from './nodes/pose_categorizer';
import { categorizerChordNode } from './nodes/categorizer_chord';
import { categoryBlendNode } from './nodes/category_blend';

const FACES_NODES: ExtensionNodes = { nodes: [faceCategorizerNode, poseCategorizerNode, categorizerChordNode, categoryBlendNode] as unknown as NodeDef<unknown>[] };

export default FACES_NODES;
