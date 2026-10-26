/**
 * The `replay-hands` node's contract with the host: the engine resource a recording the player
 * loaded is read through, and its shape. The app's Replay tool fills it; the node plays it (#600 S6:
 * code outside `src/nodes` imports the contract, never the node).
 */
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';

/** The engine resource the app's loaded recording is read through: `() => HandReplay | null`. */
export const HAND_REPLAY_RESOURCE_KEY = 'handReplay';

/** A recording loaded for replay: frames with their times (seconds from the first). */
export interface HandReplay {
  /** Changes when another recording is loaded: playback starts over. */
  id: number;
  frames: readonly HandsFrame[];
  times: readonly number[];
  loop: boolean;
}
