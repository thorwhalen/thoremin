/**
 * Graph branches: the reusable pieces an instrument's graph is composed from.
 *
 * The design record is `docs/design/instruments-as-graphs-and-extensions.md` (§3). In one
 * line: an instrument is a set of BRANCHES (wiring) plus a settings Layer (values). A branch
 * is a named, sparse piece of `GraphSpec` that attaches to the shared TRUNK by naming trunk
 * node ids in its edges. It also declares the voices it feeds the synth merge (with a role,
 * so the merge can hush instrument voices and keep a conducted score), the overlay elements
 * it wants drawn, and the feature groups whose live demand implies it.
 *
 * "Branch" is the word this codebase already used for these pieces ("the face branch", "the
 * generative branch"); it collides with git's word, and in this repository an unqualified
 * "branch" means the graph piece.
 *
 * Pure: Zod schemas and types only. No engine, no React, no DOM.
 */
import { z } from 'zod';

/** Who a voice belongs to. `instrument` voices are silenced by the merge's `hush`
 *  (a tool such as the Trainer or Conductor asking for quiet); `score` voices are kept. */
export const VOICE_ROLES = ['instrument', 'score'] as const;
export type VoiceRole = (typeof VOICE_ROLES)[number];

export const PortRefSchema = z.object({ node: z.string().min(1), port: z.string().min(1) });
export type PortRef = z.infer<typeof PortRefSchema>;

/**
 * A node a branch contributes. Names either a concrete `type` or a `slot` (resolved by the
 * composer from the slot selection, e.g. `source` → `webcam-hands`). `paramsByType` lets a
 * slotted node carry params that only make sense for one candidate (the webcam's model
 * choice); when the resolved type has no entry there, `params` (or `{}`) applies.
 */
export const BranchNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1).optional(),
    slot: z.string().min(1).optional(),
    params: z.unknown().optional(),
    paramsByType: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((n) => (n.type === undefined) !== (n.slot === undefined), {
    message: 'a branch node names either a `type` or a `slot`, not both and not neither',
  });
export type BranchNode = z.infer<typeof BranchNodeSchema>;

/**
 * An edge a branch owns. Either endpoint may live in another branch. When the far node is
 * absent from the composed graph, an `optional` edge is dropped and a required one is a
 * composition error (the fix is `requires` on the declaring branch, or `optional: true`).
 */
export const BranchEdgeSchema = z.object({
  from: PortRefSchema,
  to: PortRefSchema,
  delayed: z.boolean().optional(),
  optional: z.boolean().optional(),
});
export type BranchEdge = z.infer<typeof BranchEdgeSchema>;

export const BranchVoiceSchema = z.object({ from: PortRefSchema, role: z.enum(VOICE_ROLES) });
export type BranchVoice = z.infer<typeof BranchVoiceSchema>;

export const GraphBranchSchema = z.object({
  id: z.string().min(1),
  /** One line for the catalog and the composer's error messages. */
  description: z.string().optional(),
  /** Branch ids that must be present for this one to make sense; resolved transitively. */
  requires: z.array(z.string()).default([]),
  nodes: z.array(BranchNodeSchema).default([]),
  edges: z.array(BranchEdgeSchema).default([]),
  /** `synth-params` streams this branch contributes; the composer allocates merge inputs. */
  voices: z.array(BranchVoiceSchema).default([]),
  /** Overlay element ids this branch wants drawn (the overlay intersects with its dials). */
  overlay: z.array(z.string()).default([]),
  /** Feature-catalog group ids whose live demand implies this branch at runtime. */
  demands: z.array(z.string()).optional(),
});
export type GraphBranch = z.infer<typeof GraphBranchSchema>;
export type GraphBranchInput = z.input<typeof GraphBranchSchema>;

/** Parse and freeze a branch definition. Throws on a malformed one at module load, which is
 *  where a typo in a branch table should fail. */
export function defineBranch(input: GraphBranchInput): GraphBranch {
  return GraphBranchSchema.parse(input);
}
