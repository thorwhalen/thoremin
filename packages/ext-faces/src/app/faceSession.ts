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
import { onCarveRequest, takeCarveRequest } from '@thoremin/sdk-ui/enroll/carveRequest';
import { carveOwners, claimCarve, type CarveModalityUi } from '@thoremin/sdk-ui/enroll/modality';
import { faceModalityUi } from './modality';
import { createCategorizerStore } from './categorizers';
import { withChangeNotice } from './models';
import { createFaceSessionStore, FACE_SESSION_DEFAULTS, type FaceSessionDeps, type FaceSessionState } from './sessionStore';
import { FACE_SCRIPT, sourceFromUrl, type SyntheticScript } from './sources';
import { createFaceTestStore, FACE_TEST_DEFAULTS, type FaceTestState } from './testStore';
import { idbThumbStore, openLiveFrames } from './thumbnails';

const { modality } = faceModalityUi;
const OWNERS = carveOwners(modality);

/** The owner of the feature claim and of the hush (`faces`). */
export const FACES_CLAIMER = OWNERS.carve;
/** The owner of the live test's claim and hush (`faces-test`): its own, so ending a test never
 *  releases a recording's. */
export const FACES_TEST_CLAIMER = OWNERS.test;

/** A carve tool's session dependencies in the browser, for one modality (#385 E8): its view of the
 *  one categorizer collection, its crop and overlay, its claim owner, its scripted source. */
export function browserDepsFor(ui: CarveModalityUi, script: SyntheticScript): FaceSessionDeps {
  const owner = carveOwners(ui.modality).carve;
  return {
    source: () => sourceFromUrl(undefined, script),
    thumbs: idbThumbStore(),
    frames: openLiveFrames,
    region: ui.region,
    ...(ui.overlay ? { overlay: ui.overlay } : {}),
    ...(ui.figure ? { figure: ui.figure } : {}),
    stillsByDefault: ui.stills !== 'opt-in',
    models: withChangeNotice(createCategorizerStore(ui.modality)),
    modality: ui.modality,
    now: () => performance.now(),
    pollMs: FACE_SESSION_DEFAULTS.pollMs,
    claim: (on) => claimCarve(owner, ui.modality, on),
    capture: provideCarveCapture,
    newTakeId: () => `take-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    isoNow: () => new Date().toISOString(),
  };
}

/** A carve tool's live test store in the browser, for one modality. */
export function browserTestStoreFor(ui: CarveModalityUi, script: SyntheticScript): StoreApi<FaceTestState> {
  const owner = carveOwners(ui.modality).test;
  return createFaceTestStore({
    source: () => sourceFromUrl(undefined, script),
    claim: (on) => claimCarve(owner, ui.modality, on),
    now: () => performance.now(),
    pollMs: FACE_TEST_DEFAULTS.pollMs,
    publishMs: FACE_TEST_DEFAULTS.publishMs,
  });
}

/**
 * Apply the host's requests for this session's modality (#383: the Conductor tool asks "Your
 * poses" for the conductor's names): the pending one now, later ones as they come. A request that
 * arrives while a categorizer is open waits until the session is idle again (the vocabulary is the
 * next take's). Returns the session store, for chaining.
 */
export function withCarveRequests(store: StoreApi<FaceSessionState>): StoreApi<FaceSessionState> {
  const id = store.getState().modality.id;
  let waiting: { vocabulary: string | null } | null = null;
  const apply = () => {
    waiting = takeCarveRequest(id) ?? waiting;
    if (!waiting) return;
    const { phase } = store.getState();
    if (phase !== 'idle' && phase !== 'empty') return;
    store.getState().setVocabulary(waiting.vocabulary);
    waiting = null;
  };
  apply();
  onCarveRequest((m) => m === id && apply());
  store.subscribe((s, prev) => {
    if (waiting && s.phase !== prev.phase) apply();
  });
  return store;
}

export function browserDeps(): FaceSessionDeps {
  return browserDepsFor(faceModalityUi, FACE_SCRIPT);
}

let store: StoreApi<FaceSessionState> | null = null;

/** The page's face session store. */
export function faceSessionStore(): StoreApi<FaceSessionState> {
  return (store ??= createFaceSessionStore(browserDeps()));
}

let testStore: StoreApi<FaceTestState> | null = null;

/** The page's live test store (#330 P3). */
export function faceTestStore(): StoreApi<FaceTestState> {
  return (testStore ??= browserTestStoreFor(faceModalityUi, FACE_SCRIPT));
}
