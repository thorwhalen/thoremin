/**
 * The hand-shape session store as the app uses it (#385 E8): "Your hand shapes" is the same
 * session store, carving, test and collection as "Your faces", over the hand modality (one hand's
 * shape, side-relative), its crop and skeleton, its own claim owners (`hand-shapes`,
 * `hand-shapes-test`) and its scripted hand (`?carve.source=synthetic`). Made once per page, on
 * first use.
 */
import type { StoreApi } from 'zustand/vanilla';
import { browserDepsFor, browserTestStoreFor } from './faceSession';
import { handModalityUi } from './handModality';
import { createFaceSessionStore, type FaceSessionState } from './sessionStore';
import { HAND_SCRIPT } from './sources';
import type { FaceTestState } from './testStore';

let store: StoreApi<FaceSessionState> | null = null;

/** The page's hand-shape session store. */
export function handSessionStore(): StoreApi<FaceSessionState> {
  return (store ??= createFaceSessionStore(browserDepsFor(handModalityUi, HAND_SCRIPT)));
}

let testStore: StoreApi<FaceTestState> | null = null;

/** The page's live test store for hand shapes. */
export function handTestStore(): StoreApi<FaceTestState> {
  return (testStore ??= browserTestStoreFor(handModalityUi, HAND_SCRIPT));
}
