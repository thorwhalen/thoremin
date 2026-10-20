/**
 * The face session's state (#330 P2, P3): record a take, carve it, show it, name it, save it, and
 * open or delete a saved one; then (P3) test it and correct it: a WORKING copy of the open
 * categorizer takes the player's corrections (a live face added to a category, a sample moved,
 * a new take merged in with P1's `mergeSession`) and the live tuning, until Save; and a
 * categorizer is imported from or exported to P1's versioned file. A zustand store the panel renders; the take, the
 * stills, the edit history and where the names came from live beside it (not in it: none of them
 * is something a component renders by value).
 *
 * #385 E4, one editable carve: from Stop on, a take IS a categorizer (`working`, every hold under
 * its id), so a fresh carve and an opened one are edited the same way: re-cut k (honouring the
 * player's pins, from the samples, so an opened one re-cuts too), move holds (a pin each), name
 * (a pin), merge, split, delete; every edit is one step of an undo history that restores the
 * exact previous document.
 *
 * #385 E3: a hold's still is taken the moment the take emits it, from the live frame, cropped to
 * the modality's region, and kept by its HOLD ID (`<takeId>:<n>`, the sample's id in the file);
 * Save files every hold's still under that id. So a merge, a correction or a re-cut never
 * re-files a still, and a still is deleted only when no saved record names its hold.
 *
 * Every outside dependency is injected ({@link FaceSessionDeps}: the input source, the stills'
 * store and grabber, the saved-models collection, the clock, the claim on the face features),
 * so a test drives the whole flow with the synthetic face and in-memory stores.
 *
 * The hot-path split the app follows: the poll pushes vectors into the take at frame rate, and
 * the store is told only what a person can see change (the phase, the count of held faces, a
 * coarse elapsed time).
 *
 * Every asynchronous step checks the store's `generation` when it resumes: `reset`, a new take
 * and opening a saved categorizer each bump it, so a late result for a take no longer shown is
 * dropped instead of landing on the new one.
 *
 * #385 E2: a take may begin in **Explore** (`explore()`: the features claimed and the camera
 * read, nothing collected) and be **paused** and resumed (`pause()` / `resume()`, or
 * `toggleCapture()`, which the host's `carve.capture.toggle` command reaches through the
 * capture seam the store provides while it is live). The live feature bars and the hold ring
 * are read, not pushed: the poll feeds the bars model, and the panel reads `live()` at its own
 * rate (the hot-path rule: a holder plus a poll, never a store write per frame). The store is
 * told only when the ring's state changes.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { DEFAULT_TUNING } from '@thoremin/sdk/enroll/live';
import { keepOnly } from '@thoremin/sdk/enroll/modality';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { type FaceSessionDeps, type FaceSessionState } from './sessionStore/state';
import { createStills } from './sessionStore/stills';
import { createCarve } from './sessionStore/carve';
import { createStrip } from './sessionStore/strip';
import { createPersist } from './sessionStore/persist';
import { createEdits } from './sessionStore/edits';
import { createLive } from './sessionStore/live';
import { createTake } from './sessionStore/take';
import { createLocals, type SessionCtx } from './sessionStore/locals';

export * from './sessionStore/state';

export function createFaceSessionStore(deps: FaceSessionDeps): StoreApi<FaceSessionState> {
  const modality = deps.modality ?? faceModality;
  /** Only the modality's keys: a saved sample keeps what its categorizer can use, not the hands
   *  and body that rode along in the live vector (it is stored in localStorage). */
  const modalityOnly = (v: FeatureVector): FeatureVector => keepOnly(modality, v);
  /** The store's working state outside the zustand state (never destructured: see `SessionLocals`). */
  const loc = createLocals();

  /** A take id none of `samples`' ids is under (ids are random in the app; a test's clock-made
   *  ones could repeat), so a new hold never takes an old hold's id, or its still. */
  const freshTakeId = (samples: readonly { id: string }[]): string => {
    const used = new Set(samples.flatMap((x) => (x.id.includes(':') ? [x.id.slice(0, x.id.lastIndexOf(':'))] : [])));
    let tid = deps.newTakeId();
    for (let n = 2; used.has(tid); n++) tid = `${deps.newTakeId()}-${n}`;
    return tid;
  };

  const store = createStore<FaceSessionState>()((set, get) => {
    const ctx: SessionCtx = { set, get, deps, modality, modalityOnly, freshTakeId, loc };
    const stillsConcern = createStills(ctx);
    const stripConcern = createStrip(ctx);
    const carveConcern = createCarve(ctx, { loadThumbs: stillsConcern.loadThumbs });
    const persistConcern = createPersist(ctx, { stillsTaken: stillsConcern.stillsTaken, showOpened: carveConcern.showOpened });
    const editsConcern = createEdits(ctx, { edit: carveConcern.edit, recutOptions: carveConcern.recutOptions, showDoc: carveConcern.showDoc, roomFor: carveConcern.roomFor });
    const liveConcern = createLive(ctx);
    const takeConcern = createTake(ctx, { grabStill: stillsConcern.grabStill, refreshStrip: stripConcern.refreshStrip, refreshGhost: stripConcern.refreshGhost, show: stillsConcern.show, clearStrip: stripConcern.clearStrip, restoreEdits: carveConcern.restoreEdits, showDoc: carveConcern.showDoc, takeSamples: stripConcern.takeSamples, withLeans: stripConcern.withLeans, withLabels: stripConcern.withLabels, labelledHolds: stripConcern.labelledHolds, holdAllIn: stripConcern.holdAllIn, commit: carveConcern.commit, carveFresh: carveConcern.carveFresh, dropUrls: stillsConcern.dropUrls });
    return {
      modality,
      phase: 'idle',
      strangers: 'neutral',
      hand: 'either',
      mirror: false,
      vocabulary: null,
      keepStills: deps.stillsByDefault ?? true,
      figures: deps.figure !== undefined && modality.skeleton !== undefined,
      setupStep: 0,
      restProgress: null,
      restMoving: false,
      tooDark: false,
      k: 0,
      view: null,
      thumbs: {},
      points: 0,
      strip: [],
      stripOnce: [],
      ghost: null,
      hold: 'open',
      elapsed: 0,
      hasStills: false,
      notice: null,
      saved: [],
      openId: null,
      name: '',
      saving: false,
      working: null,
      history: { undo: 0, redo: 0 },
      tuning: DEFAULT_TUNING,
      dirty: false,
      merging: null,
      focus: null,
      holdsAs: null,
      burstName: '',
      burst: null,
      checks: {},

      ...takeConcern.actions,
      ...editsConcern.actions,
      ...persistConcern.actions,
      ...liveConcern.actions,
    };
  });
  return store;
}
