/**
 * Instruments as declared graphs: branches, the composer, and the branch table.
 * See `docs/design/instruments-as-graphs-and-extensions.md`.
 */
export {
  defineBranch,
  GraphBranchSchema,
  BranchNodeSchema,
  BranchEdgeSchema,
  BranchVoiceSchema,
  PortRefSchema,
  VOICE_ROLES,
} from './branch';
export type { GraphBranch, GraphBranchInput, BranchNode, BranchEdge, BranchVoice, PortRef, VoiceRole } from './branch';
export { composeGraph, ComposeError } from './compose';
export type { ComposeOptions, Composed, MergeTarget } from './compose';
export { BRANCHES, ALL_BRANCH_IDS, TRUNK } from './branches';
