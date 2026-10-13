/**
 * gestureStatus — a tiny store the engine writes the classifier's live per-hand
 * poses into (transition-gated: only when a pose CHANGES), so the Gestures panel
 * can show which pose each hand is currently holding without re-rendering at
 * frame rate. Ephemeral per-frame runtime state, exactly like `faceStatus` /
 * `midiStatus` — the DAG produces it; React only displays it. The dispatch
 * itself does NOT go through this store (it runs in the rAF loop, see
 * `gestureDispatch.ts`); this is display only.
 *
 * {@link makeGestureReporter} is the per-frame sink the host loop (`useEngine.ts`) registers: it
 * feeds the dispatcher every frame and writes this store only on a change.
 */
import { create } from 'zustand';
import type { Pose } from '@/nodes';
import type { OutputReader } from './generativeStatus';

/** The classifier's per-hand pose snapshot (the `poses` output port shape). */
export type HandPoses = Record<'left' | 'right', Pose>;

/** The snapshot before the engine has reported anything (or after teardown). */
export const ABSENT_POSES: HandPoses = { left: 'absent', right: 'absent' };

export interface GestureStatusState {
  poses: HandPoses;
  report(poses: HandPoses): void;
  reset(): void;
}

export const useGestureStatus = create<GestureStatusState>((set) => ({
  poses: ABSENT_POSES,
  report: (poses) => set({ poses: { ...poses } }),
  reset: () => set({ poses: ABSENT_POSES }),
}));

/** What the gesture reporter drives each frame: the dispatcher's tick (`gestureDispatch.ts`). */
export interface GestureTicker {
  tick(poses: HandPoses, now: number): void;
}

/**
 * Build the per-frame sink for gesture dispatch (#129): the classifier's per-hand poses are read
 * off the DAG each frame and handed to `gestureDispatcher` (fresh timing state per engine run),
 * which turns held-pose TRANSITIONS into command dispatches per the player's binding map; the
 * status store is written only when a pose CHANGES (transition-gated, like the face and MIDI
 * reporters), so the Gestures panel's live indicators never re-render at frame rate. The
 * dispatcher is passed in (not built here) so this display module never imports the command
 * registry, and a test can watch the ticks.
 *
 * @param now - the frame time in MILLISECONDS: the dispatcher's dwell, hold and cooldown are in ms.
 */
export function makeGestureReporter(
  engine: OutputReader,
  gestureDispatcher: GestureTicker,
  store: Pick<GestureStatusState, 'report'> = useGestureStatus.getState(),
): (now: number) => void {
  let lastPosesKey = '';
  return (now) => {
    const poses = engine.getOutput('gesture', 'poses') as HandPoses | undefined;
    if (!poses) return;
    gestureDispatcher.tick(poses, now);
    const key = `${poses.left}|${poses.right}`;
    if (key === lastPosesKey) return;
    store.report(poses);
    lastPosesKey = key;
  };
}
