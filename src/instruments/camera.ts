/**
 * Whether the camera is read at all (#869): derived from what the composed instrument and the
 * shell read, the same way the hand count is (`./hands.ts`), never assumed.
 *
 * Why. The camera used to open for every instrument, because the trunk's hand source sat in
 * every graph. An instrument that only listens (a listening game: the microphone in, the stage
 * out, the video hidden) then asked for a camera permission it never used, and on a machine with
 * no camera, or a player who refused it, it could not start at all. The derivation already knows
 * which branches are composed, so it can answer "does anything here look through the camera?";
 * the host opens the camera only when the answer is yes, and opens it then, live.
 *
 * Who reads it, and where each is declared (nothing is listed twice):
 *
 *  - a composed branch that reads the hand stream: {@link branchHands}, the hand count's own
 *    reading (declared `hands`, else inferred from an edge out of the trunk's hand nodes);
 *  - a composed branch that runs a camera model of its own: the face and body sources declare
 *    `camera: true` (`GraphBranch.camera`);
 *  - the shell, through the hand count's context ({@link HandCountContext}): a live claim on a
 *    group any camera model measures (the Lab, the Trainer, a bound categorizer, a carve take),
 *    the hand gestures, the hand skeleton overlay; plus the video backdrop, which IS the camera.
 *
 * A face or body claim also composes its source branch (by the branch's `demands`), so it is
 * counted twice over; the claim is read here directly anyway, so the answer never depends on a
 * derivation having run first. The conductor's two-hand split (`twoHandsRead`) qualifies a branch
 * that already reads the hands, so it adds nothing here.
 *
 * Pure: no store, no engine, no React.
 */
import type { GraphBranch } from '@thoremin/sdk/instruments/branch';
import { demandWantsBody, demandWantsFace, demandWantsHands } from '@thoremin/sdk/features/sources';
import { branchHands, type HandCountContext } from './hands';

/** What the shell reads of the camera, beside the instrument's branches: the hand count's
 *  readers, plus the video backdrop. */
export interface CameraReadContext extends HandCountContext {
  /** The video backdrop is drawn (`overlay.video.show`): the player is shown the camera. */
  videoShown?: boolean;
}

/** Whether one branch reads the camera: it reads the hand stream, or runs a camera model. */
export function branchReadsCamera(branch: GraphBranch): boolean {
  return branch.camera === true || branchHands(branch) > 0;
}

/** Whether the shell reads the camera, whatever the instrument composes. */
export function shellReadsCamera(ctx: CameraReadContext = {}): boolean {
  const demanded = ctx.demanded ?? new Set<string>();
  return (
    ctx.videoShown === true ||
    ctx.gesturesEnabled === true ||
    ctx.skeletonShown === true ||
    demandWantsHands(demanded) ||
    demandWantsFace(demanded) ||
    demandWantsBody(demanded)
  );
}

/**
 * Whether anything reads the camera, given the COMPOSED branches (requirements included, the
 * trunk among them) and what the shell reads. False means the host need not open it.
 */
export function deriveReadsCamera(branches: readonly GraphBranch[], ctx: CameraReadContext = {}): boolean {
  return shellReadsCamera(ctx) || branches.some(branchReadsCamera);
}
