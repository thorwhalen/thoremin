/** The codified hand-position systems (`poses.ts`), on their own so the dial's schema names them
 *  without pulling the library into the eager chunk. */
export const POSE_SYSTEMS = ['eyck', 'rockmore'] as const;
export type PoseSystem = (typeof POSE_SYSTEMS)[number];
