/**
 * The face session store as the app uses it (#330 P2): the session store over the real
 * dependencies, made once per page, on first use (that is, when the tool's panel first opens);
 * and its live test store (P3), the same way.
 *
 * While a take records it claims the face feature groups (so the face vector is computed with
 * the Lab closed, the trainer's mechanism) and hushes the instrument (making faces at the camera
 * is not playing it).
 */
import type { StoreApi } from 'zustand/vanilla';
import { FACE_TRAINING_GROUPS } from '@thoremin/sdk/features/face_groups';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import { controls } from '@thoremin/sdk-ui/host';
import { createFaceModelStore } from './models';
import { createFaceSessionStore, FACE_SESSION_DEFAULTS, type FaceSessionDeps, type FaceSessionState } from './sessionStore';
import { sourceFromUrl } from './sources';
import { createFaceTestStore, FACE_TEST_DEFAULTS, type FaceTestState } from './testStore';
import { grabFrames, idbThumbStore } from './thumbnails';

/** The owner of the feature claim and of the hush. */
export const FACES_CLAIMER = 'faces';
/** The owner of the live test's claim and hush: its own, so ending a test never releases a
 *  recording's. */
export const FACES_TEST_CLAIMER = 'faces-test';

/** Claim (or release) the face feature groups and the instrument's quiet, as `owner`. */
function claimFaces(owner: string, on: boolean): void {
  if (on) appFeatureDemand.claim(owner, FACE_TRAINING_GROUPS);
  else appFeatureDemand.release(owner);
  try {
    controls().setHush(owner, on);
  } catch {
    // No hot store in this host (a test): nothing to hush.
  }
}

export function browserDeps(): FaceSessionDeps {
  return {
    source: () => sourceFromUrl(),
    thumbs: idbThumbStore(),
    grab: grabFrames,
    models: createFaceModelStore(),
    now: () => performance.now(),
    pollMs: FACE_SESSION_DEFAULTS.pollMs,
    claim: (on) => claimFaces(FACES_CLAIMER, on),
    newTakeId: () => `take-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    isoNow: () => new Date().toISOString(),
  };
}

let store: StoreApi<FaceSessionState> | null = null;

/** The page's face session store. */
export function faceSessionStore(): StoreApi<FaceSessionState> {
  return (store ??= createFaceSessionStore(browserDeps()));
}

let testStore: StoreApi<FaceTestState> | null = null;

/** The page's live test store (#330 P3). */
export function faceTestStore(): StoreApi<FaceTestState> {
  return (testStore ??= createFaceTestStore({
    source: () => sourceFromUrl(),
    claim: (on) => claimFaces(FACES_TEST_CLAIMER, on),
    now: () => performance.now(),
    pollMs: FACE_TEST_DEFAULTS.pollMs,
    publishMs: FACE_TEST_DEFAULTS.publishMs,
  }));
}
