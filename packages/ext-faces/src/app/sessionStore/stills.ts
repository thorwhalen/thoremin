/**
 * The face session's stills (#385 E3): the object URLs of the stills in hand, showing a take's
 * stills, grabbing one from the live frame, waiting for the ones being encoded, and loading a
 * saved categorizer's thumbnails. A concern of `createFaceSessionStore` (#746).
 */
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { SessionCtx } from './locals';

/** The stills' helpers over the store's shared state. */
export function createStills(ctx: SessionCtx) {
  const { deps, loc, set } = ctx;
  const dropUrls = () => {
    for (const u of loc.urls.values()) URL.revokeObjectURL(u);
    loc.urls.clear();
  };
  const show = (gen: number) => {
    if (gen !== loc.generation) return;
    const thumbs: Record<number, string> = {};
    loc.shownIds.forEach((id, i) => {
      let url = loc.urls.get(id);
      const still = url ? undefined : loc.stills.get(id);
      if (still) loc.urls.set(id, (url = URL.createObjectURL(still)));
      url ??= loc.figureUrls.get(id);
      if (url) thumbs[i] = url;
    });
    set({ thumbs });
  };
  /** The current frame as a still, cropped to the modality's region and overlaid with its lines,
   *  both from `vector` (projected). */
  const grabStill = (vector: FeatureVector): Promise<Blob | null> =>
    loc.frames
      ? loc.frames
          .grab(deps.region ? (size) => deps.region!({ vector, ...size }) : null, deps.overlay ? (size) => deps.overlay!({ vector, ...size }) : null)
          .catch(() => null)
      : Promise.resolve(null);
  /** Every still being encoded, done. */
  const stillsTaken = () => Promise.all([...loc.pending]);
  /** Stills for `ids` filed in IndexedDB (those not in hand). Returns whether any was found. */
  const loadThumbs = async (ids: readonly string[]): Promise<boolean> => {
    const gen = loc.generation;
    let found = false;
    for (const id of new Set(ids)) {
      if (loc.urls.has(id)) {
        found = true;
        continue;
      }
      if (loc.stills.has(id)) {
        found = true;
        continue;
      }
      const b = await deps.thumbs.get(id).catch(() => null);
      if (gen !== loc.generation) return found;
      if (b && !loc.urls.has(id)) loc.urls.set(id, URL.createObjectURL(b));
      found ||= b !== null;
    }
    show(gen);
    return found;
  };
  return { dropUrls, show, grabStill, stillsTaken, loadThumbs };
}
