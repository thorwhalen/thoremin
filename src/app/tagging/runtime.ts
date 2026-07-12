/**
 * Tagging runtime bindings (#92) — thin adapters that expose the tagging store to
 * the two host subsystems that must reach it without importing zustand directly:
 *
 *  - the {@link SessionRecorder}, via the {@link TagStreamSource} contract, so
 *    `annotations.jsonl` rides in the recording folder on the shared `t0`;
 *  - the DAG overlay node, via a `ctx.resources.tagOverlay` function it reads each
 *    tick to burn the open tags + timecode into the recorded frames.
 *
 * Both are one-liners over `useTagging.getState()` — the store is the single source
 * of truth; these just present it behind the stable seams the recorder / overlay expect.
 */
import { useTagging } from './store';
import type { TagStreamSource, TagTakeEnd, TagTakeMeta } from '../recording/tagStream';
import type { TagOverlaySnapshot } from '@/taglog/presentation';

/** A TagStreamSource backed by the live tagging store, handed to the SessionRecorder. */
export const tagStreamSource: TagStreamSource = {
  active: () => useTagging.getState().active(),
  beginTake: (meta: TagTakeMeta) => useTagging.getState().beginTake(meta),
  endTake: (endT: number, end?: TagTakeEnd) => useTagging.getState().endTake(endT, end),
};

/** The overlay resource the burned-in corner HUD reads each tick (null unless a take
 *  is recording). Installed as `ctx.resources.tagOverlay` in `useEngine`. */
export function tagOverlayResource(): TagOverlaySnapshot | null {
  return useTagging.getState().overlaySnapshot();
}
