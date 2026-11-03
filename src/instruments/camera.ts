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
 *  - a composed node that runs a camera model of its own (the face, the body): the NODE declares
 *    it (`reads: READS_VIDEO`, `@thoremin/sdk/sources/video`), and a branch's nodes are resolved
 *    to their types, slot nodes through the slot selection ({@link CameraNodes}), so a slot
 *    candidate that reads no video (`?slot.body=synthetic-body`) opens no camera, and a new
 *    camera source cannot forget to say so (#960; the branch flag it replaces was a second
 *    declaration of the same fact);
 *  - the shell: its hand readers ({@link shellReadsHands}, the hand count's one list: a hand
 *    claim, the gestures, the skeleton), a claim on a face or body group (the Lab, the Trainer,
 *    a bound categorizer, a carve take), and the video backdrop, which IS the camera.
 *
 * The trunk's hand source is a camera model too, but it reads the camera for its readers, never
 * on its own: the host idles it (`no-hands`) while nothing reads the hands, and the slots given
 * here are that idle selection (`cameraNodes` in `src/app/graph.ts`), so the trunk alone counts
 * as reading nothing and the hand readers above are what count.
 *
 * A hand instrument's voices are never the trunk's: the mapping slot lives in `field-voices`
 * (composed while `handMap.maxGain > 0`) and every other instrument in a branch of its own, each
 * reading the hand stream by an edge, so {@link branchHands} counts it.
 *
 * A face or body claim also composes its source branch (by the branch's `demands`), so it is
 * counted twice over; the claim is read here directly anyway, so the answer never depends on a
 * derivation having run first. The conductor's two-hand split (`twoHandsRead`) qualifies a branch
 * that already reads the hands, so it adds nothing here.
 *
 * Pure: no store, no engine, no React.
 */
import type { GraphBranch } from '@thoremin/sdk/instruments/branch';
import { demandWantsBody, demandWantsFace } from '@thoremin/sdk/features/sources';
import { branchHands, shellReadsHands, type HandCountContext } from './hands';
import { branchNodeType } from './compose';

/** What the shell reads of the camera, beside the instrument's branches: the hand count's
 *  readers, plus the video backdrop. */
export interface CameraReadContext extends HandCountContext {
  /** The video backdrop is drawn (`overlay.video.show`): the player is shown the camera. */
  videoShown?: boolean;
}

/**
 * What the derivation knows of the nodes a branch places: the type each slot holds, and whether a
 * node type reads the camera's video (its `reads` declaration, through the registry). Bound to
 * this build's slots and registry by `cameraNodes` (`src/app/graph.ts`).
 */
export interface CameraNodes {
  /** The type each slot holds, as the host composes it while the camera is closed: the hand
   *  source idled, every other slot as selected (or its default). A slot not listed reads nothing. */
  slots: Readonly<Record<string, string>>;
  /** Whether a node of this type reads the camera's video. */
  readsVideo: (type: string) => boolean;
}

/** Whether one branch places a node that reads the camera's video (a camera model). */
export function branchRunsCameraModel(branch: GraphBranch, nodes: CameraNodes): boolean {
  return branch.nodes.some((n) => {
    const type = branchNodeType(n, nodes.slots);
    return !!type && nodes.readsVideo(type);
  });
}

/** Whether one branch reads the camera: it reads the hand stream, or runs a camera model. */
export function branchReadsCamera(branch: GraphBranch, nodes: CameraNodes): boolean {
  return branchHands(branch) > 0 || branchRunsCameraModel(branch, nodes);
}

/** Whether the shell reads the camera, whatever the instrument composes. */
export function shellReadsCamera(ctx: CameraReadContext = {}): boolean {
  const demanded = ctx.demanded ?? new Set<string>();
  return ctx.videoShown === true || shellReadsHands(ctx) || demandWantsFace(demanded) || demandWantsBody(demanded);
}

/**
 * Whether anything reads the camera, given the COMPOSED branches (requirements included, the
 * trunk among them), what their nodes are, and what the shell reads. False means the host need
 * not open it.
 */
export function deriveReadsCamera(branches: readonly GraphBranch[], nodes: CameraNodes, ctx: CameraReadContext = {}): boolean {
  return shellReadsCamera(ctx) || branches.some((b) => branchReadsCamera(b, nodes));
}
