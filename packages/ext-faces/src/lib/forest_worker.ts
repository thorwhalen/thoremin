/**
 * The re-cut forest in a Web Worker (#499): the other side of `forest_prefetch.ts`.
 *
 * `buildConstrainedForest` is quadratic in the holds (0.7 s at 2000 over 52 features on the
 * server, several times that on a tablet), so a big categorizer's first re-cut would freeze the
 * page. This builds the forest from the plain inputs the page sends and posts it back; the page
 * puts it in the forest cache, and the re-cut that follows finds it there.
 */
import { buildConstrainedForest } from '@thoremin/sdk/enroll/cluster';
import type { ForestRequest, ForestResponse } from './forest_prefetch';

const scope = self as unknown as { onmessage: ((e: { data: ForestRequest }) => void) | null; postMessage(m: ForestResponse): void };

scope.onmessage = ({ data }) => {
  try {
    const { vectors, features, weights, mustLink } = data.inputs;
    scope.postMessage({ id: data.id, forest: buildConstrainedForest(vectors, features, weights, { mustLink }) });
  } catch (e) {
    scope.postMessage({ id: data.id, error: e instanceof Error ? e.message : String(e) });
  }
};
