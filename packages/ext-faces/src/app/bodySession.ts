/**
 * The pose session store as the app uses it (#382 = #385 E9): "Your poses" is the same session
 * store, carving, test and collection as "Your faces" and "Your hand shapes", over the body
 * modality, its stick figures (stills opt-in), its own claim owners (`poses`, `poses-test`: the
 * body branch is composed only while one of them claims) and its scripted body
 * (`?carve.source=synthetic`). Made once per page, on first use; it takes the host's requests
 * (#383: the Conductor tool's "Teach my conducting poses" asks for the conductor's names).
 */
import type { StoreApi } from 'zustand/vanilla';
import { browserDepsFor, browserTestStoreFor, withCarveRequests } from './faceSession';
import { bodyModalityUi } from './bodyModality';
import { createFaceSessionStore, type FaceSessionState } from './sessionStore';
import { BODY_SCRIPT } from './sources';
import type { FaceTestState } from './testStore';

let store: StoreApi<FaceSessionState> | null = null;

/** The page's pose session store. */
export function bodySessionStore(): StoreApi<FaceSessionState> {
  return (store ??= withCarveRequests(createFaceSessionStore(browserDepsFor(bodyModalityUi, BODY_SCRIPT))));
}

let testStore: StoreApi<FaceTestState> | null = null;

/** The page's live test store for poses. */
export function bodyTestStore(): StoreApi<FaceTestState> {
  return (testStore ??= browserTestStoreFor(bodyModalityUi, BODY_SCRIPT));
}
