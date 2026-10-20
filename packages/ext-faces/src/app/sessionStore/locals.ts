/**
 * The face session store's working state outside the zustand state (#746): the take, the
 * stills, the strip, the edit history and the rest, as ONE mutable object the store's
 * concerns share by reference. Never destructure it: most fields are reassigned, so a
 * copied field is stale the moment another concern writes it.
 */
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { Tuning } from '@thoremin/sdk/enroll/live';
import type { LiveBarsModel } from '@thoremin/sdk/enroll/bars';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { NameSources } from '../../lib/carving';
import type { FaceTake } from '../../lib/take';
import type { CategorizerChecks, FaceModelRecord } from '../models';
import type { FaceSource } from '../sources';
import type { LiveFrames } from '../thumbnails';
import type { StoreApi } from 'zustand/vanilla';
import type { CarveModality } from '@thoremin/sdk/enroll/modality';
import type { FaceSessionDeps, FaceSessionState, FreshTake, MergeSeed, Snapshot } from './state';

/** The categorizer a recording is being merged into, and what to restore if it is empty. */
export type MergeBase = {
  seed: MergeSeed;
  /** Where the take returns: a fresh carve (#421: "Add more" before it is saved) or the open one. */
  phase: 'carved' | 'saved';
  /** Whether the carve it returns to has pictures (a fresh carve's are its take's). */
  hasStills: boolean;
  working: PersonalCategorizer;
  record: FaceModelRecord | null;
  openId: string | null;
  name: string;
  tuning: Tuning;
  checks: CategorizerChecks;
  dirty: boolean;
  /** Every hold of the take not named otherwise goes to this category (#435), pinned. */
  holdsIn?: string;
  /** The edit state the merge returns to (its history: the merge itself is one undoable edit). */
  edits: { sources: NameSources; undo: Snapshot[]; redo: Snapshot[]; baseRadius: number | undefined; fresh: FreshTake | null };
};

export interface SessionLocals {
  take: FaceTake | null;
  /** The live bars over the take being read (null when nothing is read). */
  bars: LiveBarsModel | null;
  /** Withdraws the capture control this store provided. */
  withdraw: (() => void) | null;
  source: FaceSource | null;
  /** The source's stream, open for stills while recording (null: no pictures this take). */
  frames: LiveFrames | null;
  /** The latest re-cut waiting for its forest (a later move of the k slider wins). */
  cutToken: number;
  takeId: string | null;
  /** Holds of the take whose still was asked for (the take's point count, as last seen). */
  stilled: number;
  /** The still of the burst under way (#385 E7), grabbed while the face is still being made (a
   *  release is often the moment it changes); filed under the burst's hold id if it takes one. */
  burstStill: Promise<Blob | null> | null;
  /** The latest live vector (where a still is cropped). */
  lastVector: FeatureVector | null;
  /** Holds of the take deleted from the strip (#404), by index: left out of the carve. */
  readonly dropped: Set<number>;
  /** Names given to holds in the strip (#404), by index ('' takes a burst's name off). */
  readonly holdNames: Map<number, string>;
  /** The side each hold of a mirrored take was read on (#529), by index; the last frame's side. */
  readonly holdSides: Map<number, boolean>;
  lastMirrored: boolean | null;
  /** The take's indices of the holds the bars carve (the ones not deleted), by position. */
  keptIdx: readonly number[];
  /** The strip as last shown (a key), and the stick figures drawn for it, by hold id. */
  stripKey: string;
  readonly stripFigures: Map<string, string>;
  /** When the paused ghost was last carved (engine ms). */
  ghostAt: number;
  timer: ReturnType<typeof setInterval> | null;
  /** A fresh take's rest, while its carve is shown (phase `carved`): the frames the reject
   *  radius is trained on, and the rest cloud (hold ids; null when there was too little rest to
   *  say), which seeds Neutral in either setting of the strangers switch (#385 E5). */
  fresh: FreshTake | null;
  /** The open categorizer's reject radius as opened: a re-cut floors from it, so k up and down
   *  does not drift. */
  baseRadius: number | undefined;
  /** How the working categorizer's names came about, by category id. */
  sources: NameSources;
  /** The edit history: what undo and redo step through. */
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  /** The last edit was a change of k: the next one joins its undo step (a slider drag, or
   *  several +, is one step). */
  lastWasK: boolean;
  openRecord: FaceModelRecord | null;
  /** The categorizer a recording is being merged into, and what to restore if it is empty. */
  /** Pause the take as soon as its rest is done (#435: "Show me on the bars"). */
  pauseOnCapture: boolean;
  mergeBase: MergeBase | null;
  /** The hold ids of the samples shown, by index (the take's holds, or the open categorizer's
   *  samples): what `thumbs` is keyed by. */
  shownIds: readonly string[];
  /** Whether this store holds the face-feature claim (and the hush). */
  claimed: boolean;
  /** Bumped whenever the shown take changes, so a late result for an old one is dropped. */
  generation: number;
  /** Object URLs of the stills in hand, by hold id. */
  readonly urls: Map<string, string>;
  /** The mirror the player chose for the next take (#382): the state shows an open categorizer's,
   *  and a reset returns to this. */
  chosenMirror: boolean;
  /** The vocabulary chosen for the next take (#383): a reset returns to it. */
  chosenVocabulary: string | null;
  /** The shown samples' stick-figure pictures, by hold id (#382): where a hold has no still. */
  readonly figureUrls: Map<string, string>;
  /** The stills taken this session, by hold id: in memory until a save files them in
   *  IndexedDB, so a take nobody saves leaves nothing behind. Kept across a merge's take (the
   *  base's in-memory stills stay shown) until `reset`. */
  readonly stills: Map<string, Blob>;
  /** The stills still being encoded, so Save waits for them. */
  readonly pending: Set<Promise<void>>;
}

/** A fresh store's working state. */
export function createLocals(): SessionLocals {
  return {
    take: null,
    bars: null,
    withdraw: null,
    source: null,
    frames: null,
    cutToken: 0,
    takeId: null,
    stilled: 0,
    burstStill: null,
    lastVector: null,
    dropped: new Set<number>(),
    holdNames: new Map<number, string>(),
    holdSides: new Map<number, boolean>(),
    lastMirrored: null,
    keptIdx: [],
    stripKey: '',
    stripFigures: new Map<string, string>(),
    ghostAt: Number.NEGATIVE_INFINITY,
    timer: null,
    fresh: null,
    baseRadius: undefined,
    sources: new Map(),
    undoStack: [],
    redoStack: [],
    lastWasK: false,
    openRecord: null,
    pauseOnCapture: false,
    mergeBase: null,
    shownIds: [],
    claimed: false,
    generation: 0,
    urls: new Map<string, string>(),
    chosenMirror: false,
    chosenVocabulary: null,
    figureUrls: new Map<string, string>(),
    stills: new Map<string, Blob>(),
    pending: new Set<Promise<void>>(),
  };
}

/** What every concern of the store is built from: the store's own `set` and `get`, its
 *  dependencies, its modality, and the shared working state. */
export interface SessionCtx {
  set: StoreApi<FaceSessionState>['setState'];
  get: StoreApi<FaceSessionState>['getState'];
  deps: FaceSessionDeps;
  modality: CarveModality;
  /** Only the modality's keys of a vector (what a saved sample keeps). */
  modalityOnly: (v: FeatureVector) => FeatureVector;
  /** A take id none of `samples`' ids is under. */
  freshTakeId: (samples: readonly { id: string }[]) => string;
  loc: SessionLocals;
}
