/**
 * The categorizer's heavy stages in a Web Worker (#499, #587): the other side of
 * `forest_prefetch.ts`.
 *
 * `buildConstrainedForest` is quadratic in the holds (0.9 s at 3000 over 52 features on the
 * server, several times that on a tablet), and `mergeSession` validates and re-derives thousands
 * of samples (0.3 s at 3000): either would freeze the page. This runs one request at a time from
 * the plain data the page sends and posts the result back (the forest, to be put in the forest
 * cache; or the merge's result, an ordinary `MergeResult`).
 */
import { buildConstrainedForest } from '@thoremin/sdk/enroll/cluster';
import { mergeSession } from '@thoremin/sdk/enroll/from_model';
import type { WorkRequest, WorkResponse } from './forest_prefetch';

const scope = self as unknown as { onmessage: ((e: { data: WorkRequest }) => void) | null; postMessage(m: WorkResponse): void };

scope.onmessage = ({ data }) => {
  try {
    if (data.kind === 'merge') {
      scope.postMessage({ id: data.id, merge: mergeSession(data.base, data.points, data.options) });
      return;
    }
    const { vectors, features, weights, mustLink } = data.inputs;
    scope.postMessage({ id: data.id, forest: buildConstrainedForest(vectors, features, weights, { mustLink }) });
  } catch (e) {
    scope.postMessage({ id: data.id, error: e instanceof Error ? e.message : String(e) });
  }
};
