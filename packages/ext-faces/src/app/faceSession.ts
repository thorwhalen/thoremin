/**
 * The face session store as the app uses it (#330 P2): the session store over the real
 * dependencies, made once per page, on first use (that is, when the tool's panel first opens);
 * and its live test store (P3), the same way.
 *
 * While a take explores or records it claims the face feature groups (so the face vector is
 * computed with the Lab closed, the trainer's mechanism) and hushes the instrument (making faces
 * at the camera is not playing it), and provides its capture control to the host's
 * `carve.capture.toggle` command (Space).
 */
import type { StoreApi } from 'zustand/vanilla';
import { provideCarveCapture } from '@thoremin/sdk-ui/enroll/capture';
import { carveOwners, claimCarve } from '@thoremin/sdk-ui/enroll/modality';
import { faceModalityUi } from './modality';
import { createFaceModelStore, withChangeNotice } from './models';
import { createFaceSessionStore, FACE_SESSION_DEFAULTS, type FaceSessionDeps, type FaceSessionState } from './sessionStore';
import { sourceFromUrl } from './sources';
import { createFaceTestStore, FACE_TEST_DEFAULTS, type FaceTestState } from './testStore';
import { idbThumbStore, openLiveFrames } from './thumbnails';

const { modality } = faceModalityUi;
const OWNERS = carveOwners(modality);

/** The owner of the feature claim and of the hush (`faces`). */
export const FACES_CLAIMER = OWNERS.carve;
/** The owner of the live test's claim and hush (`faces-test`): its own, so ending a test never
 *  releases a recording's. */
export const FACES_TEST_CLAIMER = OWNERS.test;

export function browserDeps(): FaceSessionDeps {
  return {
    source: () => sourceFromUrl(),
    thumbs: idbThumbStore(),
    frames: openLiveFrames,
    region: faceModalityUi.region,
    models: withChangeNotice(createFaceModelStore()),
    modality,
    now: () => performance.now(),
    pollMs: FACE_SESSION_DEFAULTS.pollMs,
    claim: (on) => claimCarve(FACES_CLAIMER, modality, on),
    capture: provideCarveCapture,
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
    claim: (on) => claimCarve(FACES_TEST_CLAIMER, modality, on),
    now: () => performance.now(),
    pollMs: FACE_TEST_DEFAULTS.pollMs,
    publishMs: FACE_TEST_DEFAULTS.publishMs,
  }));
}
