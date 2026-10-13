/**
 * The face session store as the app uses it (#330 P2): the session store over the real
 * dependencies, made once per page, on first use (that is, when the tool's panel first opens).
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
import { grabFrames, idbThumbStore } from './thumbnails';

/** The owner of the feature claim and of the hush. */
export const FACES_CLAIMER = 'faces';

export function browserDeps(): FaceSessionDeps {
  return {
    source: () => sourceFromUrl(),
    thumbs: idbThumbStore(),
    grab: grabFrames,
    models: createFaceModelStore(),
    now: () => performance.now(),
    pollMs: FACE_SESSION_DEFAULTS.pollMs,
    claim: (on) => {
      if (on) appFeatureDemand.claim(FACES_CLAIMER, FACE_TRAINING_GROUPS);
      else appFeatureDemand.release(FACES_CLAIMER);
      try {
        controls().setHush(FACES_CLAIMER, on);
      } catch {
        // No hot store in this host (a test): nothing to hush.
      }
    },
    newTakeId: () => `take-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    isoNow: () => new Date().toISOString(),
  };
}

let store: StoreApi<FaceSessionState> | null = null;

/** The page's face session store. */
export function faceSessionStore(): StoreApi<FaceSessionState> {
  return (store ??= createFaceSessionStore(browserDeps()));
}
