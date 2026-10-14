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
import {
  MAX_CATEGORIZER_SAMPLES,
  categorizerFromModel,
  modelFromCategorizer,
  exportCategorizer,
  importCategorizer,
  type CategorizerStrangers,
  type PersonalCategorizer,
  type SampleInput,
} from '@thoremin/sdk/enroll/categorizer';
import { neutralIndices } from '@thoremin/sdk/enroll/carve';
import { TRAIN_DEFAULTS } from '@thoremin/sdk/enroll/classify';
import { mergeSession } from '@thoremin/sdk/enroll/from_model';
import {
  deleteHolds as deleteHoldsFrom,
  mergeCategories,
  moveHolds as moveHoldsIn,
  nameCategory,
  NEW_CATEGORY,
  anchorNames,
  placeLabelled,
  type LabelledHolds,
  consistentPins,
  mirrorOn,
  recut,
  recutBounds,
  recutRange,
  setNeutralTrained,
  setStrangers as setStrangersOf,
  splitCategory,
  type Place,
  type RecutOptions,
  type SortResult,
} from '@thoremin/sdk/enroll/sorting';
import type { NamedCollectionStore, NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import { carveTake, fullMean, generalContextOf, nameCarve, sortingView, type NameSources, type SortingView } from '../lib/carving';
import { addSample, moveSample, type CorrectionResult } from '../lib/corrections';
import { clampTuning, DEFAULT_TUNING, flooredRejectRadius, sameTuning, type Tuning } from '@thoremin/sdk/enroll/live';
import { createFaceTake, vocabularyCue, type FaceTake, type HoldState } from '../lib/take';
import { createReader, foreignModality, keepOnly, type CarveModality, type HandChoice, type ModalityOptions } from '@thoremin/sdk/enroll/modality';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { createLiveBars, liveStrip, type BarMark, type LiveBars, type LiveBarsContext, type LiveBarsModel } from '@thoremin/sdk/enroll/bars';
import { NEUTRAL_TARGET } from '@thoremin/sdk/enroll/quality';
import type { CaptureState, CarveCaptureControl } from '@thoremin/sdk-ui/enroll/capture';
import type { CarveModalityUi } from '@thoremin/sdk-ui/enroll/modality';
import type { CategoryBinder } from '@thoremin/sdk-ui/enroll/binder';
import type { CategorizerChecks, FaceModelRecord, SavedFaceModel } from './models';
import type { FaceSource } from './sources';
import { holdId, type FrameOpener, type LiveFrames, type ThumbStore } from './thumbnails';
import type { VocabularyImporter } from '@thoremin/sdk-ui/enroll/vocabularyImport';
import { categoryEntries } from '../lib/vocabularyEntries';
import { MAX_CATEGORY_SLOTS } from '../schema';

export type FacePhase =
  /** Nothing recorded; the saved list and Record. */
  | 'idle'
  /** The camera read (the bars, the ring), nothing recorded yet (#385 E2). */
  | 'explore'
  /** Recording the resting face. */
  | 'rest'
  /** Recording the player's faces. */
  | 'faces'
  /** The capture paused: the camera still read, nothing collected (#385 E2). */
  | 'paused'
  /** Stop was pressed: the take is being carved. */
  | 'stopping'
  /** A take carved: its working categorizer in the sorting grid (k, the strangers switch, moves,
   *  names, merge, split, undo), Save. */
  | 'carved'
  /** A take that held no face long enough to carve. */
  | 'empty'
  /** A categorizer open (saved, imported or merged): the same sorting grid (a re-cut of k too,
   *  from its samples), the live test, corrections and the tuning. */
  | 'saved';

/** What a new take merged into the open categorizer keeps of it (P1's `mergeSession` seed):
 *  `samples`, more of the same player; `centroids`, only the categories (a model made by
 *  someone else, retrained on this face). */
export type MergeSeed = 'samples' | 'centroids';

/** What "Show me on the bars" shows (#435): a category's distinguishing features and the two
 *  centres, the category's and its neighbour's (raw vectors). */
export interface BarFocus {
  category: string;
  label: string;
  features: readonly string[];
  marks: readonly BarMark[];
}

/** Whether a phase is a recording in progress (closing the tool must end it). */
export const isRecording = (phase: FacePhase): boolean => phase === 'rest' || phase === 'faces' || phase === 'paused' || phase === 'stopping';

/** Whether a phase reads the camera (claims the features, hushes the instrument): exploring
 *  or recording. Closing the tool ends it. */
export const isLive = (phase: FacePhase): boolean => phase === 'explore' || isRecording(phase);

export interface FaceSessionDeps {
  source: () => FaceSource;
  thumbs: ThumbStore;
  /** Opens the source's stream for stills, taken at capture (#385 E3). */
  frames: FrameOpener;
  /** The crop for a still (the modality's region; the whole frame by default). */
  region?: CarveModalityUi['region'];
  /** Lines burned into a still as it is taken (the modality's overlay: a hand's skeleton). */
  overlay?: CarveModalityUi['overlay'];
  models: NamedCollectionStore<FaceModelRecord, SavedFaceModel>;
  /** Engine-clock ms. */
  now: () => number;
  /** How often the live vector is read while recording. */
  pollMs: number;
  /** Claim (true) or release the face features and the instrument's quiet while recording. */
  claim: (on: boolean) => void;
  /** A fresh take id: a take's holds are `<takeId>:<n>` (and a correction's own sample id is
   *  a fresh take's first). */
  newTakeId: () => string;
  /** Wall-clock ISO time, for the saved file. */
  isoNow: () => string;
  /** What is carved (the face by default): the keys a sample keeps, the cues, the names, the
   *  modality a file must be to import. */
  modality?: CarveModality;
  /** Provide the live take's capture control for the host's `carve.capture.toggle` command
   *  (`@thoremin/sdk-ui/enroll/capture`'s `provideCarveCapture`); returns its withdrawal. None
   *  by default. */
  capture?: (control: CarveCaptureControl) => () => void;
  /** A hold's picture drawn from its stick figure (#382: the modality's `figure`, a URL), shown
   *  where it has no camera still. None by default. */
  figure?: CarveModalityUi['figure'];
  /** Whether a take keeps camera stills unless the player says otherwise (#387 C7: yes for a face
   *  or a hand, no for a body, whose stick figure is its picture). Default true. */
  stillsByDefault?: boolean;
}

/** One card of the live strip (#404). */
export interface StripCardView {
  /** The card's number: the hold's place in the take, from 1 (kept when an earlier one goes). */
  n: number;
  /** The card number of the first hold of its group, or null: the first of its group (new). */
  like: number | null;
  /** The name given to it (in the strip, or as a named burst), or null. */
  name: string | null;
  /** Its picture (a still, else a stick figure), or null. */
  thumb: string | null;
}

export interface FaceSessionState {
  /** What this store carves (constant): the panels read their words and the live test its
   *  projection from it. */
  readonly modality: CarveModality;
  phase: FacePhase;
  /** What a face nobody taught reads as (#385 E5): the working categorizer's, or the next take's
   *  before there is one. */
  strangers: CategorizerStrangers;
  /** Which hand a hand categorizer reads (#385 E8): the working categorizer's, or the next
   *  take's before there is one. `either` for every other modality (it reads no hand). */
  hand: HandChoice;
  /** A pose and its mirror image read as one (#382, #387 B10): the working categorizer's, or the
   *  next take's before there is one. False for every modality without a mirror. */
  mirror: boolean;
  /** The default-name vocabulary (#383): the working categorizer's, or the next take's before
   *  there is one (the body's `conductor` when the Conductor tool asked for it); null: chosen by
   *  coverage. */
  vocabulary: string | null;
  /** Whether the next take keeps camera stills (#387 C7: opt-in for a body). */
  keepStills: boolean;
  /** Whether holds have a stick figure for a picture (constant: the modality draws one). */
  figures: boolean;
  /** Which setup step the rest is at (#382): 0 the rest itself, then the modality's nuisance
   *  cues in order. */
  setupStep: number;
  /** The rest's progress toward its end (#403), 0..1 in steps; null outside the rest itself. */
  restProgress: number | null;
  /** Whether the player moved during the rest just now (#403: "stay relaxed"). */
  restMoving: boolean;
  k: number;
  /** The sorting grid over {@link FaceSessionState.working} (#385 E4). */
  view: SortingView | null;
  /** Object URLs of the stills in hand, by index into the shown samples (the take's holds, or
   *  the open categorizer's samples). */
  thumbs: Readonly<Record<number, string>>;
  /** Held faces captured so far (while recording). */
  points: number;
  /** The live strip (#404): a card per hold of the take so far (capturing or paused), the ones
   *  deleted from it left out. */
  strip: readonly StripCardView[];
  /** The strip's groups held only once so far, by card number ("#3: do it again"). */
  stripOnce: readonly number[];
  /** While paused and holding: what that hold would be, by the strip's carve (`like` a card
   *  number, null: a new one); null otherwise. */
  ghost: { like: number | null } | null;
  /** The hold ring's state (exploring, capturing or paused). */
  hold: HoldState;
  /** Seconds since Record (while recording). */
  elapsed: number;
  /** Whether pictures are taken (recording) or found (an open categorizer); false: the grid
   *  has none. */
  hasStills: boolean;
  notice: string | null;
  saved: readonly NamedSummary[];
  /** The saved categorizer open in the grid (phase `saved`), by record id. */
  openId: string | null;
  /** The name the Save field starts from. */
  name: string;
  /** A save is in flight (Save is disabled meanwhile). */
  saving: boolean;
  /** The ONE editable carve (#385 E4): a fresh take's categorizer (phase `carved`) or the open
   *  one (phase `saved`), with its unsaved edits; null otherwise. */
  working: PersonalCategorizer | null;
  /** How many edits undo and redo can step through. */
  history: { undo: number; redo: number };
  /** The open categorizer's live tuning (phase `saved`). */
  tuning: Tuning;
  /** Something shown is not saved: a fresh carve, a correction, a merge, an import, a tuning. */
  dirty: boolean;
  /** The take being recorded is merged into the open categorizer, with this seed. */
  merging: MergeSeed | null;
  /** A hint shown on the bars (#435, design C.4.8): the features that tell `label` from its
   *  neighbour, shown first, and the two centres marked; the take drops into Paused after the rest
   *  so the player rehearses the bigger version, and its holds go to `label`. Null otherwise. */
  focus: BarFocus | null;
  /** The category every hold of the take under way goes to (#435: "Record more"), or null. */
  holdsAs: string | null;
  /** The name the next burst's hold is given (#385 E7): '' for none (the carve decides). */
  burstName: string;
  /** The burst under way (its name and frames so far, coarsely), or null. */
  burst: { label: string; frames: number } | null;
  /** The open categorizer's quiz and everyday-check results (#385 E7), kept with it on Save. */
  checks: CategorizerChecks;

  /** Read the camera without recording (#385 E2): the bars and the ring run; Start captures. */
  explore(): void;
  /** Delete a hold of the take being recorded from the strip (#404), by card number: it is
   *  left out of the carve (or the merge). */
  dropHold(n: number): void;
  /** Name a hold of the take being recorded (#404), by card number: like a named burst, it is
   *  placed and pinned in the category of that name. '' takes the name off. */
  nameHold(n: number, name: string): void;
  /** Record: the rest, then the faces. From Explore it goes on with the same reading. */
  start(): void;
  /** Stop collecting faces; the camera is still read (from `faces`). */
  pause(): void;
  /** Collect faces again (from `paused`). */
  resume(): void;
  /** Space: Explore starts, capturing pauses, paused resumes (the rest is left to end). */
  toggleCapture(): void;
  /** The name the next burst is given ('' for none). */
  setBurstName(name: string): void;
  /** Begin a burst (#385 E7: a key or button held): every frame is collected until
   *  {@link FaceSessionState.endBurst}, then one hold, named {@link FaceSessionState.burstName}. */
  beginBurst(): void;
  /** End the burst; a burst too short to take says so. */
  endBurst(): void;
  /** The live feature bars now, or null when nothing is read. Not reactive: a panel polls it. */
  live(options?: { count?: number; pinned?: readonly string[] }): LiveBars | null;
  stop(): Promise<void>;
  /** The strangers switch: what a face nobody taught reads as, Neutral or the nearest face. An
   *  edit of the working categorizer (undoable); before a take, the next take's setting. */
  setStrangers(strangers: CategorizerStrangers): void;
  /** Which hand: an edit of the working categorizer (undoable; no hold moves, but the live test
   *  and the instrument read that hand from then on); before a take, the next take's setting. */
  setHand(hand: HandChoice): void;
  /** The mirror: before a take, the next take's setting (#382); on a carved or saved categorizer
   *  (#459), turning it ON is an undoable edit (`mirrorOn`: every hold read on one side, then a
   *  re-cut at the suggested k), and turning it off is refused (no hold kept its side). */
  setMirror(on: boolean): void;
  /** The default-name vocabulary of the take under way or the next one (#383; null: chosen by
   *  coverage). It applies to ONE take: once that take is a categorizer (which keeps it), the
   *  choice returns to null. Refused while a categorizer is open. */
  setVocabulary(vocabulary: string | null): void;
  /** Keep camera stills on the next take (#387 C7). */
  setKeepStills(on: boolean): void;
  /** Skip the setup step under way (a nuisance demonstration), on to the next. */
  skipSetup(): void;
  /** Train the Neutral holds of an older categorizer (migrated with them untrained). Undoable. */
  teachNeutral(): boolean;
  setK(k: number): void;
  rename(id: string, label: string): void;
  save(name: string): Promise<boolean>;
  refreshSaved(): Promise<void>;
  open(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Back to the list, dropping the take (and stopping a recording). */
  reset(): void;
  /** End a recording without keeping it: a merge take returns to the categorizer it was adding
   *  to (its unsaved changes kept); any other take is dropped, as `reset`. */
  cancelRecording(): void;
  /** Set the open categorizer's live tuning (kept with it on Save). */
  setTuning(tuning: Partial<Tuning>): void;
  /** Keep a quiz's or an everyday check's result with the open categorizer (on Save). */
  setChecks(checks: Partial<CategorizerChecks>): void;
  /** "This face is `id`": add a live face to a category of the open categorizer. */
  correct(id: string, vector: FeatureVector): boolean;
  /** Move sample `index` of the working categorizer to category `to` (null: out of every one,
   *  into neutral or set aside as its strangers say). A pin, as every move. */
  move(index: number, to: string | null): boolean;
  /** Move holds (by sample id) to a category, `neutral`, `aside` or `NEW_CATEGORY`; pinned there. */
  moveHolds(ids: readonly string[], to: Place): boolean;
  /** Delete holds (by sample id); a category they empty goes too. Undoable. */
  deleteHolds(ids: readonly string[]): boolean;
  /** Merge category `from` into `into` (both's holds pinned to `into`). */
  merge(from: string, into: string): boolean;
  /** Split a category in two (its own sub-hierarchy cut at 2, both halves pinned). */
  split(id: string): boolean;
  /** Step the working categorizer back to before the last edit (exactly), or forward again. */
  undo(): void;
  redo(): void;
  /** Record a new take and merge it into the working categorizer (P1's `mergeSession`): the open
   *  one, or a fresh carve before it is saved (#421); `burstName` names its bursts ("Record more
   *  frown"); `name` is the Save field's text, there again when the take returns; `holdsAs`
   *  names every hold the take makes (#435: "Record more" for one category). */
  startMerge(seed: MergeSeed, options?: { burstName?: string; name?: string; holdsAs?: string }): void;
  /** A hint's "Record more" (#435): a take whose every hold goes to category `id` (pinned, so
   *  it stays there at every k), its bursts named for it too. False when it cannot start. */
  recordMore(id: string): boolean;
  /** A hint's "Show me on the bars" (#435): the take of {@link recordMore}, its bars showing the
   *  features the hint names first with the category's and its neighbour's centres marked, paused
   *  after the rest. False when the category has no hint. */
  showOnBars(id: string): boolean;
  /** Open a categorizer from a file's text (validated, older versions migrated); not saved yet. */
  importFile(text: string): boolean;
  /** The categorizer shown, as a file's text (P1's versioned format): an open one, or a fresh
   *  carve before it is saved (#369), named `name` when given (the Save field's text), else
   *  its own name, else {@link FACE_SESSION_DEFAULTS.exportName}. Null with nothing to export. */
  exportFile(name?: string): { name: string; text: string } | null;
  /** A saved categorizer as a file's text, without opening it (#369): the SAVED version, not
   *  unsaved edits on it while it is open. Null (and a notice) if it cannot be read. */
  exportSaved(id: string): Promise<{ name: string; text: string } | null>;
  /** Hand the SAVED categorizer `id` to the host's category bindings (#385 E8: a command per
   *  category), by id (#371): the host plays it from its record, tuning and all, so a later edit
   *  needs no re-bind. Returns whether it was bound. */
  bindSaved(id: string, binder: CategoryBinder): Promise<boolean>;
  /** Copy the SAVED categorizer `id`'s categories into another extension's vocabulary (#451: a
   *  hand-shape categorizer named as chords becomes the air guitar's chords), through the importer
   *  that vocabulary provides. `confirm` is asked before entries of the same name are replaced.
   *  Says what was imported and skipped; returns whether anything was. */
  importSaved(id: string, importer: VocabularyImporter, confirm: (question: string) => boolean): Promise<boolean>;
  /** The SAVED categorizer `id`'s category names (null when it cannot be read). */
  savedLabels(id: string): Promise<string[] | null>;
}

export const FACE_SESSION_DEFAULTS = {
  /** How often the paused ghost card (#404) carves the forming hold again, ms. */
  ghostMs: 250,
  /** The most holds the ghost re-carves with, four times a second inside the poll loop, so it
   *  must fit a frame on a slow device: about 12 ms at 200 over 52 features since #420 (was 150,
   *  as fast before); past it there is no ghost. */
  ghostUpTo: 200,
  /** The name a fresh face carve is exported under when it has none yet (another modality's:
   *  "My <many>"). */
  exportName: 'My faces',
  pollMs: 33,
  exemplars: 4,
  /** How many edits undo keeps. */
  undoDepth: 100,
  /** The most holds a suggested k is computed over on every edit (the forest, quadratic since
   *  #420: about 0.13 s at 800 holds over 52 features, 0.75 s at 2000). */
  suggestUpTo: 800,
  /** The most holds a re-cut carves at once on the main thread: the file's bound (about 0.8 s
   *  at 2000 since #420). Only a record saved before the bound existed can be larger. */
  recutUpTo: MAX_CATEGORIZER_SAMPLES,
  /** The most categories a carve makes: one per chord slot an instrument has. */
  maxCategories: MAX_CATEGORY_SLOTS,
  /** A burst's frame count is shown in steps of this many. */
  burstShowStep: 5,
  /** Frames into a burst its still is taken. */
  burstStillAfter: 3,
  /** The rest ring (#403) moves in steps of this much (0..1). */
  restProgressStep: 0.05,
  /** During the rest, a frame this far from the rest so far (`FaceTake.restMotion`: noise units,
   *  its largest feature off the rest frames' median) is movement: "stay relaxed". The recorded
   *  face's still rest reaches about 12, its smile 100 (the range floor's ceiling). */
  restMovingAt: 20,
  /** A movement in the rest must last this long to say "stay relaxed", ms (a blink is shorter). */
  restMovingForMs: 300,
  /** "Stay relaxed" stays up this long after the last movement, ms, so it does not flicker. */
  restMovingHoldMs: 1000,
} as const;

/** A fresh take's rest while its carve is shown: its frames, and the rest cloud by hold id. */
type FreshTake = { rest: readonly FeatureVector[]; cloud: ReadonlySet<string> | null };

/** One step of the edit history: the working categorizer and how its names came about. */
interface Snapshot {
  working: PersonalCategorizer;
  sources: NameSources;
}

/** `c` reading `hand` (`either` is written as absent, as a fresh file writes it). */
function withHand(c: PersonalCategorizer, hand: HandChoice): PersonalCategorizer {
  const { hand: _h, ...rest } = c;
  void _h;
  return hand === 'either' ? rest : { ...rest, hand };
}

export function createFaceSessionStore(deps: FaceSessionDeps): StoreApi<FaceSessionState> {
  const modality = deps.modality ?? faceModality;
  /** Only the modality's keys: a saved sample keeps what its categorizer can use, not the hands
   *  and body that rode along in the live vector (it is stored in localStorage). */
  const modalityOnly = (v: FeatureVector): FeatureVector => keepOnly(modality, v);
  let take: FaceTake | null = null;
  /** The live bars over the take being read (null when nothing is read). */
  let bars: LiveBarsModel | null = null;
  /** Withdraws the capture control this store provided. */
  let withdraw: (() => void) | null = null;
  let source: FaceSource | null = null;
  /** The source's stream, open for stills while recording (null: no pictures this take). */
  let frames: LiveFrames | null = null;
  let takeId: string | null = null;
  /** Holds of the take whose still was asked for (the take's point count, as last seen). */
  let stilled = 0;
  /** The still of the burst under way (#385 E7), grabbed while the face is still being made (a
   *  release is often the moment it changes); filed under the burst's hold id if it takes one. */
  let burstStill: Promise<Blob | null> | null = null;
  /** The latest live vector (where a still is cropped). */
  let lastVector: FeatureVector | null = null;
  /** Holds of the take deleted from the strip (#404), by index: left out of the carve. */
  const dropped = new Set<number>();
  /** Names given to holds in the strip (#404), by index ('' takes a burst's name off). */
  const holdNames = new Map<number, string>();
  /** The take's indices of the holds the bars carve (the ones not deleted), by position. */
  let keptIdx: readonly number[] = [];
  /** The strip as last shown (a key), and the stick figures drawn for it, by hold id. */
  let stripKey = '';
  const stripFigures = new Map<string, string>();
  /** When the paused ghost was last carved (engine ms). */
  let ghostAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** A fresh take's rest, while its carve is shown (phase `carved`): the frames the reject
   *  radius is trained on, and the rest cloud (hold ids; null when there was too little rest to
   *  say), which seeds Neutral in either setting of the strangers switch (#385 E5). */
  let fresh: FreshTake | null = null;
  /** The open categorizer's reject radius as opened: a re-cut floors from it, so k up and down
   *  does not drift. */
  let baseRadius: number | undefined;
  /** How the working categorizer's names came about, by category id. */
  let sources: NameSources = new Map();
  /** The edit history: what undo and redo step through. */
  let undoStack: Snapshot[] = [];
  let redoStack: Snapshot[] = [];
  /** The last edit was a change of k: the next one joins its undo step (a slider drag, or
   *  several +, is one step). */
  let lastWasK = false;
  let openRecord: FaceModelRecord | null = null;
  /** The categorizer a recording is being merged into, and what to restore if it is empty. */
  /** Pause the take as soon as its rest is done (#435: "Show me on the bars"). */
  let pauseOnCapture = false;
  let mergeBase: {
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
    /** Every hold of the take goes to the category of this name (#435), unless named otherwise. */
    holdsAs?: string;
    /** The edit state the merge returns to (its history: the merge itself is one undoable edit). */
    edits: { sources: NameSources; undo: Snapshot[]; redo: Snapshot[]; baseRadius: number | undefined; fresh: FreshTake | null };
  } | null = null;
  /** The hold ids of the samples shown, by index (the take's holds, or the open categorizer's
   *  samples): what `thumbs` is keyed by. */
  let shownIds: readonly string[] = [];
  /** Whether this store holds the face-feature claim (and the hush). */
  let claimed = false;
  /** Bumped whenever the shown take changes, so a late result for an old one is dropped. */
  let generation = 0;
  /** Object URLs of the stills in hand, by hold id. */
  const urls = new Map<string, string>();
  /** The mirror the player chose for the next take (#382): the state shows an open categorizer's,
   *  and a reset returns to this. */
  let chosenMirror = false;
  /** The vocabulary chosen for the next take (#383): a reset returns to it. */
  let chosenVocabulary: string | null = null;
  /** The shown samples' stick-figure pictures, by hold id (#382): where a hold has no still. */
  const figureUrls = new Map<string, string>();
  /** The stills taken this session, by hold id: in memory until a save files them in
   *  IndexedDB, so a take nobody saves leaves nothing behind. Kept across a merge's take (the
   *  base's in-memory stills stay shown) until `reset`. */
  const stills = new Map<string, Blob>();
  /** The stills still being encoded, so Save waits for them. */
  const pending = new Set<Promise<void>>();

  /** A take id none of `samples`' ids is under (ids are random in the app; a test's clock-made
   *  ones could repeat), so a new hold never takes an old hold's id, or its still. */
  const freshTakeId = (samples: readonly { id: string }[]): string => {
    const used = new Set(samples.flatMap((x) => (x.id.includes(':') ? [x.id.slice(0, x.id.lastIndexOf(':'))] : [])));
    let tid = deps.newTakeId();
    for (let n = 2; used.has(tid); n++) tid = `${deps.newTakeId()}-${n}`;
    return tid;
  };

  const store = createStore<FaceSessionState>()((set, get) => {
    const dropUrls = () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    };
    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const release = () => {
      stopPolling();
      frames?.close();
      frames = null;
      if (claimed) deps.claim(false);
      claimed = false;
      source?.dispose();
      source = null;
      bars = null;
      withdraw?.();
      withdraw = null;
    };

    /** `reset`, keeping the stills taken this session: a merge's take (or its cancel) returns to
     *  a working categorizer whose earlier merged holds have their pictures only in memory. */
    const resetKeepingStills = () => {
      const kept = [...stills];
      get().reset();
      for (const [id, b] of kept) stills.set(id, b);
    };

    /** The capture state the host's command sees (null when nothing is live). */
    const captureState = (): CaptureState | null => {
      const phase = get().phase;
      return phase === 'explore' ? 'explore' : phase === 'rest' ? 'rest' : phase === 'faces' ? 'capturing' : phase === 'paused' ? 'paused' : null;
    };
    const provideCapture = () => {
      if (withdraw || !deps.capture) return;
      const control: CarveCaptureControl = { what: modality.words.many, state: () => captureState() ?? 'explore', toggle: () => get().toggleCapture() };
      withdraw = deps.capture(control);
    };

    /** The bars' view of a take: its features, its noise unit, its rest once there is one, and
     *  its holds (the arrays cached, so the online carve runs once per new hold). */
    const barsFor = (t: FaceTake): LiveBarsModel => {
      const session = t.session();
      const ids = session.featuresFor(vocabularyCue(modality));
      let holds: { n: number; gone: number; vectors: FeatureVector[] } = { n: 0, gone: 0, vectors: [] };
      let rest: { mean: FeatureVector; spread: Record<string, number> } | null = null;
      const context = (): LiveBarsContext => {
        const points = session.points();
        if (points.length !== holds.n || dropped.size !== holds.gone) {
          // The holds deleted from the strip are not carved (#404): the cards say what Stop will.
          keptIdx = points.flatMap((_, i) => (dropped.has(i) ? [] : [i]));
          holds = { n: points.length, gone: dropped.size, vectors: keptIdx.map((i) => points[i].vector) };
        }
        if (!rest && t.facesStartedAt() !== null) rest = restStats(t.restVectors(), ids);
        const noise = session.noise();
        return { ids, sigma: (id) => (noise.isWarm(id) ? noise.sigma(id) : Number.NaN), rest: rest?.mean ?? null, restSpread: rest?.spread ?? null, holds: holds.vectors };
      };
      return createLiveBars(context);
    };

    /** The rest ring and "stay relaxed" (#403), told to the store only when they change. A
     *  movement counts once it has lasted `restMovingForMs` (a blink is not one), and shows for
     *  `restMovingHoldMs` after it ends. */
    let overSince: number | null = null;
    let movedAt = Number.NEGATIVE_INFINITY;
    const resetRestWatch = () => {
      overSince = null;
      movedAt = Number.NEGATIVE_INFINITY;
    };
    const restWatch = (progress: number | null, motion: number | null, tMs: number) => {
      const step = FACE_SESSION_DEFAULTS.restProgressStep;
      const shown = progress === null ? null : Math.floor(progress / step + 1e-9) * step;
      if (progress === null) resetRestWatch();
      else if (motion === null || motion < FACE_SESSION_DEFAULTS.restMovingAt) overSince = null;
      else {
        overSince ??= tMs;
        if (tMs - overSince >= FACE_SESSION_DEFAULTS.restMovingForMs) movedAt = tMs;
      }
      const moving = tMs - movedAt < FACE_SESSION_DEFAULTS.restMovingHoldMs;
      const s = get();
      if (s.restProgress !== shown || s.restMoving !== moving) set({ restProgress: shown, restMoving: moving });
    };

    /** How the source is read: a merge reads with its base's hand, a fresh take with the chosen. */
    const readOptions = (): ModalityOptions =>
      mergeBase ? { hand: mergeBase.working.hand ?? 'either', mirror: mergeBase.working.mirror === true } : { hand: get().hand, mirror: get().mirror };
    /** Read the source into the take every `pollMs`, telling the store only what a person can
     *  see change (the phase, the count of held faces, the ring, a coarse elapsed time). */
    const poll = (t0: number) => {
      stopPolling();
      let lastShown = -1;
      // The vector the carve works in (#385 E8): one hand made side-relative; the face as is. A
      // mirrored body take holds its side (#382), a merge chooses the side nearer its base.
      const readLive = createReader(modality, readOptions(), mergeBase?.working.mirror ? modelFromCategorizer(mergeBase.working) : undefined);
      timer = setInterval(() => {
        if (!take || !source) return;
        const read = source.read();
        const live = read ? { ...read, vector: readLive(read.vector) } : null;
        if (live) {
          take.push(live.vector, live.t);
          bars?.push(modality.read(live.vector), live.t);
          lastVector = live.vector;
          // A burst's still: once a few frames in, from the frame showing now.
          const b = take.burst();
          if (b && !burstStill && frames && b.frames >= FACE_SESSION_DEFAULTS.burstStillAfter) burstStill = grabStill(live.vector);
          stillNewHolds(live.vector);
        }
        let tp = take.phase();
        // "Show me on the bars" (#435): the rest done, the take waits paused for the rehearsal.
        if (tp === 'faces' && pauseOnCapture) {
          pauseOnCapture = false;
          take.pause(deps.now());
          tp = take.phase();
        }
        const phaseNow: FacePhase = tp === 'explore' || tp === 'rest' || tp === 'faces' || tp === 'paused' ? tp : get().phase;
        const elapsed = phaseNow === 'explore' ? 0 : Math.floor((deps.now() - t0) / 250) / 4;
        const points = take.pointCount();
        const hold = take.hold();
        const step = take.setupStep();
        if (step !== get().setupStep) set({ setupStep: step });
        restWatch(take.restProgress(), take.restMotion(), live?.t ?? deps.now());
        const b = take.burst();
        // The burst's frames coarsely (a person sees it grow, not every frame).
        const burst = b ? { label: b.label, frames: b.frames - (b.frames % FACE_SESSION_DEFAULTS.burstShowStep) } : null;
        const s = get();
        const burstChanged = (s.burst === null) !== (burst === null) || (burst !== null && (s.burst!.frames !== burst.frames || s.burst!.label !== burst.label));
        if (s.phase !== phaseNow || s.points !== points || elapsed !== lastShown || s.hold !== hold || burstChanged) {
          lastShown = elapsed;
          set({ phase: phaseNow, points, elapsed, hold, ...(burstChanged ? { burst } : {}) });
        }
        refreshStrip();
        refreshGhost(live?.vector ?? null, live?.t ?? deps.now());
      }, deps.pollMs);
    };
    /** A new take's strip: nothing deleted, named or shown yet. */
    const clearStrip = () => {
      dropped.clear();
      holdNames.clear();
      keptIdx = [];
      stripKey = '';
      stripFigures.clear();
      ghostAt = Number.NEGATIVE_INFINITY;
      set({ strip: [], stripOnce: [], ghost: null });
    };
    /** A hold's picture for the strip: its still once encoded, else its stick figure. */
    const stripThumb = (index: number, id: string): string | null => {
      let url = urls.get(id);
      const still = url ? undefined : stills.get(id);
      if (still) urls.set(id, (url = URL.createObjectURL(still)));
      if (url) return url;
      if (!deps.figure || !modality.skeleton || !take) return null;
      if (!stripFigures.has(id)) {
        const point = take.session().points()[index];
        const skeleton = point ? modality.skeleton(point.vector) : null;
        const fig = skeleton ? deps.figure(skeleton) : null;
        if (!fig) return null;
        stripFigures.set(id, fig);
      }
      return stripFigures.get(id) ?? null;
    };
    /** The live strip (#404) from the bars' online carve, set only when what it shows changed. */
    const refreshStrip = () => {
      const phase = get().phase;
      if (!take || !bars || !takeId || (phase !== 'faces' && phase !== 'paused')) {
        if (stripKey !== '') {
          stripKey = '';
          set({ strip: [], stripOnce: [] });
        }
        return;
      }
      const tid = takeId;
      const labels = take.labels();
      const nameOf = (i: number): string => (holdNames.get(i) ?? labels.get(i) ?? '').trim();
      // A named hold goes where Stop puts it: with the holds of its name (pinned there), whatever
      // the carve says; the carve's groups keep the unnamed ones.
      const byName = new Map<string, number[]>();
      const clusters = bars
        .carve()
        .map((c) =>
          c.flatMap((p) => {
            const i = keptIdx[p];
            if (i === undefined) return [];
            const name = nameOf(i).toLowerCase();
            if (!name) return [i];
            byName.set(name, [...(byName.get(name) ?? []), i]);
            return [];
          }),
        )
        .concat([...byName.values()]);
      const { cards, once } = liveStrip(clusters);
      const strip: StripCardView[] = cards.map((c) => ({ n: c.index + 1, like: c.like === null ? null : c.like + 1, name: nameOf(c.index) || null, thumb: stripThumb(c.index, holdId(tid, c.index)) }));
      const stripOnce = once.map((i) => i + 1);
      // The change key without the pictures' text (a stick figure is a data URL of kilobytes).
      const key = `${strip.map((c) => `${c.n}:${c.like ?? ''}:${c.name ?? ''}:${c.thumb ? c.thumb.length : 0}`).join('|')}/${stripOnce.join(',')}`;
      if (key === stripKey) return;
      stripKey = key;
      set({ strip, stripOnce });
    };
    /** While paused and a hold is forming, what it would be (#404), carved at most every
     *  `ghostMs`; null otherwise. */
    const refreshGhost = (vector: FeatureVector | null, tMs: number) => {
      const s = get();
      const forming =
        s.phase === 'paused' && (s.hold === 'settling' || s.hold === 'taken') && vector !== null && bars !== null && keptIdx.length > 0 && keptIdx.length <= FACE_SESSION_DEFAULTS.ghostUpTo;
      if (!forming) {
        if (s.ghost !== null) set({ ghost: null });
        ghostAt = Number.NEGATIVE_INFINITY;
        return;
      }
      if (tMs - ghostAt < FACE_SESSION_DEFAULTS.ghostMs && s.ghost !== null) return;
      ghostAt = tMs;
      const joins = bars!.wouldBe(vector!);
      // Said in the strip's terms: the card it would join, by that card's group leader (one more
      // point can split a group, and the ghost must not contradict the cards).
      const first = joins ? Math.min(...joins.map((p) => keptIdx[p])) + 1 : null;
      const card = first === null ? undefined : s.strip.find((c) => c.n === first);
      const like = first === null ? null : (card?.like ?? first);
      if (s.ghost?.like !== like || s.ghost === null) set({ ghost: { like } });
    };
    const show = (gen: number) => {
      if (gen !== generation) return;
      const thumbs: Record<number, string> = {};
      shownIds.forEach((id, i) => {
        let url = urls.get(id);
        const still = url ? undefined : stills.get(id);
        if (still) urls.set(id, (url = URL.createObjectURL(still)));
        url ??= figureUrls.get(id);
        if (url) thumbs[i] = url;
      });
      set({ thumbs });
    };

    /** The current frame as a still, cropped to the modality's region and overlaid with its lines,
     *  both from `vector` (projected). */
    const grabStill = (vector: FeatureVector): Promise<Blob | null> =>
      frames
        ? frames
            .grab(deps.region ? (size) => deps.region!({ vector, ...size }) : null, deps.overlay ? (size) => deps.overlay!({ vector, ...size }) : null)
            .catch(() => null)
        : Promise.resolve(null);
    /** Take a still for each hold the take emitted since the last poll, from the frame showing
     *  now (the hold was just taken, so the face is still held), cropped to the region the live
     *  vector places the part in. */
    const stillNewHolds = (vector: FeatureVector) => {
      if (!take || !takeId) return;
      const n = take.pointCount();
      const tid = takeId;
      for (; stilled < n; stilled++) {
        const id = holdId(tid, stilled);
        if (!frames) continue;
        const gen = generation;
        // A burst's hold has its still already (taken mid-burst); any other is taken now.
        const grabbed = burstStill ?? grabStill(vector);
        burstStill = null;
        const job = grabbed
          .then((still) => {
            // Kept even if the take is no longer shown: the id is this hold's alone, and a merge
            // that ended a moment ago may be saved with it.
            if (!still || stills.has(id)) return;
            stills.set(id, still);
            show(gen);
            if (gen === generation) refreshStrip();
          })
          .finally(() => pending.delete(job));
        pending.add(job);
      }
    };
    /** A burst just ended (released, or ended by a pause, a resume or Stop): its hold's still
     *  filed under its id, or dropped when it took no hold. */
    const afterBurst = () => {
      if (!take || take.burst()) return;
      if (lastVector) stillNewHolds(lastVector);
      burstStill = null;
    };
    /** Every still being encoded, done. */
    const stillsTaken = () => Promise.all([...pending]);
    /** Stills for `ids` filed in IndexedDB (those not in hand). Returns whether any was found. */
    const loadThumbs = async (ids: readonly string[]): Promise<boolean> => {
      const gen = generation;
      let found = false;
      for (const id of new Set(ids)) {
        if (urls.has(id)) {
          found = true;
          continue;
        }
        if (stills.has(id)) {
          found = true;
          continue;
        }
        const b = await deps.thumbs.get(id).catch(() => null);
        if (gen !== generation) return found;
        if (b && !urls.has(id)) urls.set(id, URL.createObjectURL(b));
        found ||= b !== null;
      }
      show(gen);
      return found;
    };
    /** The take's holds, as the samples a categorizer is made of: their ids, the modality's
     *  keys only, and their supporting frames. */
    const takeSamples = (t: FaceTake, tid: string): SampleInput[] =>
      t
        .session()
        .points()
        .map((p, i) => ({ ...p, id: holdId(tid, i), vector: modalityOnly(p.vector), support: t.support(i), skeleton: modality.skeleton?.(p.vector) ?? null }));

    /** The take's labelled holds (#385 E7: bursts under a typed name), by name, as sample ids. */
    const labelledHolds = (t: FaceTake, tid: string, holdsAs?: string): LabelledHolds[] => {
      const by = new Map<string, { label: string; ids: string[] }>();
      // A take for one category (#435) names every hold it; a name of its own wins.
      const names = new Map<number, string>();
      if (holdsAs?.trim()) for (let i = 0; i < t.pointCount(); i++) names.set(i, holdsAs);
      // A name given in the strip (#404) is a burst's name given afterwards: it wins over one.
      for (const [i, name] of t.labels()) names.set(i, name);
      for (const [i, name] of holdNames) names.set(i, name);
      for (const [i, raw] of names) {
        const label = raw.trim();
        if (!label || dropped.has(i)) continue;
        const key = label.toLowerCase();
        const g = by.get(key) ?? { label, ids: [] };
        g.ids.push(holdId(tid, i));
        by.set(key, g);
      }
      return [...by.values()];
    };
    /** `c` with the take's labelled holds placed and pinned (unchanged when there are none). A
     *  failure is said, and the holds are carved like any other. */
    const withLabels = (c: PersonalCategorizer, groups: readonly LabelledHolds[]): { categorizer: PersonalCategorizer; named: string[]; error: string | null } => {
      if (groups.length === 0) return { categorizer: c, named: [], error: null };
      const r = placeLabelled(c, groups, { neutralLabel: modality.words.neutral });
      if (!r.ok) return { categorizer: c, named: [], error: r.error };
      // A name that is new makes a category: never past the most an instrument has chords for.
      const grown = r.categorizer.categories.length > c.categories.length;
      if (grown && r.categorizer.categories.length > FACE_SESSION_DEFAULTS.maxCategories) {
        return { categorizer: c, named: [], error: `a new name would make more than ${FACE_SESSION_DEFAULTS.maxCategories} categories, the most an instrument has chords for` };
      }
      const named = r.categorizer.categories.filter((cat) => groups.some((g) => g.label.toLowerCase() === cat.label.trim().toLowerCase())).map((cat) => cat.id);
      return { categorizer: r.categorizer, named, error: null };
    };

    /** What a re-cut of the working categorizer trains its reject radius from. */
    const recutOptions = (): RecutOptions =>
      fresh ? { rest: fresh.rest, baseRejectRadius: TRAIN_DEFAULTS.defaultRejectRadius } : { baseRejectRadius: baseRadius };

    /** Show `working` in the sorting grid: its view, its stills by sample id (in memory from this
     *  session's takes first, then filed in IndexedDB). An open categorizer learns whether it has
     *  pictures from what is found; a fresh take's are still being encoded. */
    const showDoc = (working: PersonalCategorizer, patch: Partial<FaceSessionState> = {}) => {
      // The bounds on every show; the suggestion (which builds the forest) only for a pool a
      // person can wait for.
      const bounds = recutBounds(working, recutOptions());
      const recutable = bounds.pool <= FACE_SESSION_DEFAULTS.recutUpTo;
      const maxK = Math.min(bounds.maxK, FACE_SESSION_DEFAULTS.maxCategories);
      const suggested = recutable && bounds.pool <= FACE_SESSION_DEFAULTS.suggestUpTo ? recutRange(working, recutOptions()).suggestedK : working.categories.length;
      const range = recutable ? { minK: bounds.minK, maxK, suggestedK: Math.min(suggested, maxK), recutable } : { minK: working.categories.length, maxK: working.categories.length, suggestedK: working.categories.length, recutable };
      const view = sortingView(working, { sources, range, neutralKnown: fresh ? fresh.cloud !== null : true, modality });
      shownIds = working.samples.map((x) => x.id);
      figureUrls.clear();
      if (deps.figure) {
        for (const x of working.samples) {
          // The figure kept with the sample, else drawn from its vector (a file made without one).
          const skeleton = x.skeleton ?? modality.skeleton?.(x.vector) ?? null;
          const url = skeleton ? deps.figure(skeleton) : null;
          if (url) figureUrls.set(x.id, url);
        }
      }
      set({ working, view, strangers: working.strangers, hand: working.hand ?? 'either', mirror: working.mirror === true, vocabulary: working.vocabulary ?? null, k: view.k, history: { undo: undoStack.length, redo: redoStack.length }, ...patch });
      const gen = generation;
      void loadThumbs(shownIds).then((found) => {
        if (gen === generation && get().working === working && get().phase === 'saved') set({ hasStills: found });
      });
    };
    /** Show an opened categorizer (phase `saved`): a fresh history, its names as saved. */
    const showOpened = (opened: PersonalCategorizer, patch: Partial<FaceSessionState> = {}) => {
      const working = consistentPins(opened);
      fresh = null;
      lastWasK = false;
      baseRadius = working.rejectRadius;
      sources = new Map();
      undoStack = [];
      redoStack = [];
      showDoc(working, { phase: 'saved', ...patch });
    };
    /** Put back the edit state a merge take left (its history, names and radius). */
    const restoreEdits = (e: NonNullable<typeof mergeBase>['edits']) => {
      // A fresh carve keeps its first take's rest (#421): the reject radius and Neutral's seed.
      fresh = e.fresh;
      sources = e.sources;
      undoStack = e.undo;
      redoStack = e.redo;
      baseRadius = e.baseRadius;
      lastWasK = false;
    };
    /** Make `next` the working categorizer, as one undoable edit: its unnamed categories named. */
    const commit = (next: PersonalCategorizer, patch: Partial<FaceSessionState> = {}, { k = false }: { k?: boolean } = {}) => {
      const cur = get().working;
      const joins = k && lastWasK && undoStack.length > 0;
      lastWasK = k;
      if (cur && !joins) {
        undoStack = [...undoStack, { working: cur, sources }].slice(-FACE_SESSION_DEFAULTS.undoDepth);
        redoStack = [];
      }
      const named = nameCarve(next, { modality, sources, restCloud: fresh?.cloud ?? undefined });
      sources = named.sources;
      showDoc(named.categorizer, { dirty: true, notice: null, ...patch });
    };
    /** Apply an edit of the working categorizer (in either phase), or say why not. */
    const edit = (run: (working: PersonalCategorizer) => SortResult | CorrectionResult, options: { k?: boolean } = {}): boolean => {
      const { working, phase } = get();
      if (!working || (phase !== 'carved' && phase !== 'saved')) return false;
      const r = run(working);
      if (!r.ok) {
        set({ notice: `Not changed: ${r.error}.` });
        return false;
      }
      commit(r.categorizer, {}, options);
      return true;
    };
    /** Refused when the edit would make more categories than an instrument has chords for. */
    const roomFor = (working: PersonalCategorizer): SortResult | null =>
      working.categories.length >= FACE_SESSION_DEFAULTS.maxCategories
        ? { ok: false, error: `${FACE_SESSION_DEFAULTS.maxCategories} categories is the most (one per chord slot an instrument has); merge two first` }
        : null;

    /** Carve the fresh take `base` (`carveTake`: the rest cloud in Neutral) and show it. */
    const carveFresh = (base: PersonalCategorizer) => {
      if (!fresh) return;
      const { result, allNearRest } = carveTake(base, { ...fresh, baseRejectRadius: TRAIN_DEFAULTS.defaultRejectRadius, maxCategories: FACE_SESSION_DEFAULTS.maxCategories });
      if (!result.ok) {
        set({ notice: `Nothing to carve: ${result.error}.` });
        return;
      }
      const { one, many } = modality.words;
      const notice = allNearRest
        ? `Every held ${one} was close to your resting ${one}, so none was put in Neutral: all are carved. Move the resting ones to Neutral, or record again with stronger ${many}.`
        : null;
      const named = nameCarve(result.categorizer, { modality, sources, restCloud: fresh.cloud ?? undefined });
      sources = named.sources;
      showDoc(named.categorizer, { dirty: true, notice });
    };

    /** Delete the stills of `ids` that no saved record's samples name any more. */
    const dropStillsIfOrphaned = async (ids: readonly string[]) => {
      if (ids.length === 0) return;
      const records = await Promise.all((await deps.models.list()).map((x) => deps.models.load(x.id).catch(() => null)));
      // A record that cannot be read may name these holds: then nothing is deleted.
      if (records.some((r) => r === null)) return;
      const named = new Set(records.flatMap((r) => r!.model.categorizer.samples.map((x) => x.id)));
      const orphans = ids.filter((id) => !named.has(id));
      if (orphans.length > 0) await deps.thumbs.remove(orphans).catch(() => undefined);
    };

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

      explore() {
        if (isLive(get().phase)) return;
        get().reset();
        source = deps.source();
        take = createFaceTake({ modality });
        bars = barsFor(take);
        deps.claim(true);
        claimed = true;
        take.explore(deps.now());
        set({ phase: 'explore', points: 0, elapsed: 0, hold: 'open', notice: null, view: null, thumbs: {}, openId: null, name: '', merging: null, focus: null, holdsAs: null });
        provideCapture();
        poll(deps.now());
      },

      dropHold(n) {
        const phase = get().phase;
        const i = n - 1;
        if (!take || (phase !== 'faces' && phase !== 'paused') || !Number.isInteger(i) || i < 0 || i >= take.pointCount() || dropped.has(i)) return;
        dropped.add(i);
        refreshStrip();
      },

      nameHold(n, name) {
        const phase = get().phase;
        const i = n - 1;
        if (!take || (phase !== 'faces' && phase !== 'paused') || !Number.isInteger(i) || i < 0 || i >= take.pointCount() || dropped.has(i)) return;
        holdNames.set(i, name.trim());
        refreshStrip();
      },

      start() {
        const exploring = get().phase === 'explore' && take !== null && source !== null;
        if (isRecording(get().phase)) return;
        const merge = mergeBase;
        if (!exploring) {
          if (merge) resetKeepingStills();
          else get().reset();
          mergeBase = merge;
          source = deps.source();
          // A merge keeps its base's features and weights, so it has no use for the nuisances.
          take = createFaceTake({ modality, nuisance: !merge });
          bars = barsFor(take);
          deps.claim(true);
          claimed = true;
        }
        else {
          // A fresh source for the capture: the live one is stateless (the tap and the camera
          // stay), and the scripted one starts its script, rest first, when the capture does.
          source!.dispose();
          source = deps.source();
        }
        takeId = freshTakeId(merge?.working.samples ?? []);
        stilled = 0;
        clearStrip();
        const stream = get().keepStills ? source!.video() : null;
        frames = stream ? deps.frames(stream) : null;
        const t0 = deps.now();
        take!.start(t0);
        resetRestWatch();
        set({ phase: 'rest', setupStep: 0, restProgress: 0, restMoving: false, points: 0, elapsed: 0, hold: 'open', hasStills: frames !== null, notice: null, view: null, thumbs: {}, openId: null, name: merge?.name ?? '', merging: merge?.seed ?? null });
        provideCapture();
        poll(t0);
      },

      pause() {
        if (get().phase !== 'faces' || !take) return;
        take.pause(deps.now());
        afterBurst();
        set({ phase: 'paused', hold: take.hold(), burst: null, points: take.pointCount() });
      },

      resume() {
        if (get().phase !== 'paused' || !take) return;
        take.resume(deps.now());
        afterBurst();
        set({ phase: 'faces', hold: take.hold(), burst: null, points: take.pointCount() });
      },

      toggleCapture() {
        const phase = get().phase;
        if (phase === 'explore') get().start();
        else if (phase === 'faces') get().pause();
        else if (phase === 'paused') get().resume();
      },

      setBurstName(name) {
        set({ burstName: name });
      },

      beginBurst() {
        const phase = get().phase;
        if (!take || (phase !== 'faces' && phase !== 'paused')) return;
        if (take.beginBurst(deps.now(), get().burstName)) set({ burst: { label: get().burstName.trim(), frames: 0 }, hold: take.hold(), notice: null });
      },

      endBurst() {
        if (!take || !take.burst()) return;
        const took = take.endBurst(deps.now());
        afterBurst();
        set({
          burst: null,
          hold: take.hold(),
          points: take.pointCount(),
          ...(took ? {} : { notice: `That burst was too short to take: hold the key for a moment while you make the ${modality.words.one}.` }),
        });
      },

      live(options = {}) {
        if (!bars || !isLive(get().phase) || get().phase === 'stopping') return null;
        const focus = get().focus;
        if (!focus) return bars.snapshot(options);
        // The hint's features first, then the player's own pins; the two centres marked.
        const pinned = [...focus.features, ...(options.pinned ?? []).filter((id) => !focus.features.includes(id))];
        return bars.snapshot({ ...options, pinned, marks: focus.marks });
      },

      async stop() {
        const phase = get().phase;
        if (phase !== 'rest' && phase !== 'faces' && phase !== 'paused') return;
        // Synchronously out of the recording phases: a second Stop, or the panel's cleanup, now
        // sees a take being stopped, not one to stop again.
        set({ phase: 'stopping', restProgress: null, restMoving: false });
        const myTake = take!;
        const hadStills = frames !== null;
        let built = false;
        try {
          // A burst held through Stop is a hold like a released one, with its still.
          if (myTake.burst()) {
            myTake.endBurst(deps.now());
            afterBurst();
          }
          stopPolling();
          built = myTake.stop();
        } finally {
          release();
        }
        const merge = mergeBase;
        mergeBase = null;
        if (merge) {
          openRecord = merge.record;
          // The name a "Record more X" gave the bursts belongs to that take only.
          const restore = { openId: merge.openId, name: merge.name, tuning: merge.tuning, checks: merge.checks, merging: null, focus: null, holdsAs: null, burst: null, burstName: '' };
          // Back to the categorizer the take was adding to, its edit history and all.
          restoreEdits(merge.edits);
          // A fresh carve has pictures when either take took them (an open one finds its own).
          showDoc(merge.working, { phase: merge.phase, ...restore, ...(merge.phase === 'carved' ? { hasStills: merge.hasStills || hadStills } : {}), dirty: merge.dirty });
          // A merge needs no carve of its own, so one hold (a single burst: "Record more frown")
          // is enough; a fresh take needs two to carve.
          if (!built && myTake.pointCount() === 0) {
            set({ notice: `No ${modality.words.one} was held long enough to add. Nothing was merged.` });
            return;
          }
          // The holds deleted from the strip (#404) are not merged.
          const added = takeSamples(myTake, takeId!).filter((_, i) => !dropped.has(i));
          if (added.length === 0) {
            set({ notice: `Every held ${modality.words.one} was deleted. Nothing was merged.` });
            return;
          }
          // New faces are sorted with the FLOORED radius the readout uses (a file's tiny stored
          // radius would set every new face aside); not with the dial's scale, which stays a live
          // setting rather than being written into the samples' radius.
          const base = merge.working.strangers === 'neutral' ? { ...merge.working, rejectRadius: flooredRejectRadius(merge.working) } : merge.working;
          let result: ReturnType<typeof mergeSession>;
          try {
            result = mergeSession(base, added, { seed: merge.seed });
          } catch (err) {
            // A working copy the merge cannot read (it validates): the base kept, said plainly.
            set({ notice: `Nothing was merged: ${err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err)}` });
            return;
          }
          // The import bound (addSample keeps it too): a categorizer merged past it could not
          // be read back from its own exported file. Refused as a notice, the base kept.
          if (result.categorizer.samples.length > MAX_CATEGORIZER_SAMPLES) {
            set({ notice: `Nothing was merged: the result would hold ${result.categorizer.samples.length} ${modality.words.many}, more than the ${MAX_CATEGORIZER_SAMPLES} a categorizer keeps.` });
            return;
          }
          // Bursts recorded under a name go to the category of that name (or a new one), pinned
          // (#385 E7): "Record more frown" lands in frown, whatever is nearest.
          const labelled = withLabels(result.categorizer, labelledHolds(myTake, takeId!, merge.holdsAs));
          for (const id of labelled.named) if (!sources.has(id)) sources = new Map([...sources, [id, { source: 'edited', matched: null }]]);
          // Every sample keeps its id (the base's, and the new holds' `<takeId>:<n>`), so every
          // still stays filed where it is: the new ones are filed on Save, nothing is re-filed.
          const joined = result.assigned.filter((a) => a >= 0).length;
          const untouched = result.untouched.map((id) => result.categorizer.categories.find((c) => c.id === id)?.label || id);
          // One undoable edit: undo returns to the categorizer before the merge.
          commit(labelled.categorizer, {
            notice:
              (labelled.error ? `The named ${modality.words.many} were sorted like the others (${labelled.error}). ` : '') +
              `Merged: ${joined} of ${added.length} new ${modality.words.many} joined a category` +
              (added.length > joined ? ` (${added.length - joined} read as none of these)` : '') +
              (untouched.length > 0 ? `; no new ${modality.words.one} for ${untouched.map((l) => `"${l}"`).join(', ')}` : '') +
              '. Save to keep it.',
          });
          return;
        }
        if (!built) {
          const { one } = modality.words;
          set({
            phase: 'empty',
            notice:
              phase === 'rest'
                ? `The take stopped during the rest, before any ${one} was held. Record again and keep going after the rest.`
                : `No ${one} was held long enough to carve. Hold each ${one} for a moment.`,
          });
          return;
        }
        // The take becomes the working categorizer at once (#385 E4): every hold with its id, all
        // in one category, then carved at the suggested k, the rest cloud in Neutral.
        const session = myTake.session();
        const samples = takeSamples(myTake, takeId!);
        const rest = myTake.restVectors();
        const cloud = neutralIndices(session.points().map((p) => p.vector), rest, session.features(), session.weights());
        const strangers = get().strangers;
        const unlabelled = categorizerFromModel(session.modelFor([samples.map((_, i) => i)]), samples, { name: '', strangers, modality: modality.id, hand: get().hand, mirror: get().mirror, vocabulary: get().vocabulary ?? undefined, createdAt: deps.isoNow() });
        // One take's choice: the categorizer keeps it, the next take starts from coverage again.
        chosenVocabulary = null;
        // Bursts recorded under a name are pinned to a category of that name before the carve, so
        // the re-cut keeps them together (must-link) at every k (#385 E7).
        const labelled = withLabels(unlabelled, labelledHolds(myTake, takeId!));
        // The holds deleted from the strip (#404) go before the carve, so it never sees them.
        const gone = samples.flatMap((x, i) => (dropped.has(i) ? [x.id] : []));
        const kept = gone.length > 0 ? deleteHoldsFrom(labelled.categorizer, gone) : { ok: true as const, categorizer: labelled.categorizer };
        if (!kept.ok) {
          set({ phase: 'empty', burst: null, notice: `Every held ${modality.words.one} was deleted, so there is nothing to carve. Record again.` });
          return;
        }
        fresh = { rest, cloud: cloud ? new Set(cloud.flatMap((i) => (dropped.has(i) ? [] : [samples[i].id]))) : null };
        // The typed names are the player's: kept as theirs (the general model never renames them).
        for (const id of labelled.named) sources = new Map([...sources, [id, { source: 'edited', matched: null }]]);
        set({ phase: 'carved', hasStills: hadStills, name: '', dirty: true, burst: null });
        carveFresh(kept.categorizer);
        if (labelled.error) set({ notice: `The named holds were carved like the others: ${labelled.error}.` });
      },

      setStrangers(strangers) {
        const { phase, working } = get();
        if (!working || (phase !== 'carved' && phase !== 'saved')) {
          if (phase === 'idle' || phase === 'empty') set({ strangers });
          return;
        }
        if (strangers === working.strangers) return;
        // Neutral is taught by example in both settings, so the switch moves no hold and re-cuts
        // nothing: it says only what a face far from every category reads as.
        edit((w) => setStrangersOf(w, strangers, recutOptions()));
      },

      setHand(hand) {
        const { phase, working } = get();
        if (!working || (phase !== 'carved' && phase !== 'saved')) {
          if (phase === 'idle' || phase === 'empty') set({ hand });
          return;
        }
        if (hand === (working.hand ?? 'either')) return;
        edit((w) => ({ ok: true, categorizer: withHand(w, hand) }));
      },

      setMirror(on) {
        const { phase, working } = get();
        if (working && (phase === 'carved' || phase === 'saved')) {
          // After the take (#459): ON is one undoable edit (every hold on one side, re-cut at the
          // suggested k); OFF cannot be undone that way, since no hold kept its side.
          if (!on || working.mirror || !modality.mirrorImage || !modality.mirrorSide) return;
          if (!get().view?.recutable) {
            set({ notice: `Not changed: ${working.samples.length} ${modality.words.many} are too many to sort again here; merge categories or delete some first.` });
            return;
          }
          const image = modality.mirrorImage;
          const side = modality.mirrorSide;
          // A name carries when it is the player's, and never a SIDED default name ("right arm up":
          // the general model's without the mirror and not with it), which a reopened categorizer
          // cannot tell from a typed one: the mirror's words name that category afresh.
          const labelsOf = (c: PersonalCategorizer) => new Set((modality.general?.(generalContextOf(c))?.labels ?? []).map((l) => l.toLowerCase()));
          const unsided = labelsOf({ ...working, mirror: true });
          const { mirror: _mirror, ...unmirrored } = working;
          void _mirror;
          const sided = [...labelsOf(unmirrored)].filter((l) => !unsided.has(l));
          const carry = (cat: PersonalCategorizer['categories'][number]) =>
            ['kept', 'edited'].includes(sources.get(cat.id)?.source ?? 'kept') && cat.label.trim() !== '' && !sided.includes(cat.label.trim().toLowerCase());
          edit((w) => mirrorOn(w, { image, side, skeleton: modality.skeleton ? (v) => modality.skeleton!(v) : undefined }, { ...recutOptions(), carry, maxCategories: FACE_SESSION_DEFAULTS.maxCategories }));
          return;
        }
        if (phase !== 'idle' && phase !== 'empty') return;
        chosenMirror = on;
        set({ mirror: on });
      },

      setVocabulary(vocabulary) {
        // Read when a take becomes a categorizer, so any time before that is in time.
        if (get().working) return;
        chosenVocabulary = vocabulary;
        set({ vocabulary });
      },

      setKeepStills(on) {
        if (!isLive(get().phase)) set({ keepStills: on });
      },

      skipSetup() {
        if (get().phase !== 'rest' || !take) return;
        take.skipSetup(deps.now());
        set({ setupStep: take.setupStep() });
      },

      teachNeutral() {
        return edit((w) => setNeutralTrained(w, true));
      },

      setK(k) {
        const { working, view } = get();
        const want = Math.min(Math.round(k), FACE_SESSION_DEFAULTS.maxCategories);
        if (!working || !view || want === view.k) return;
        if (!view.recutable) {
          set({ notice: `Not changed: ${working.samples.length} ${modality.words.many} are too many to re-cut here; merge categories or delete some instead.` });
          return;
        }
        // A name saved before pins existed (or kept from the file) is the player's: anchored
        // first, so the re-cut keeps it (the general model's proposals are not).
        const kept = (cat: PersonalCategorizer['categories'][number]) => ['kept', 'edited'].includes(sources.get(cat.id)?.source ?? 'kept') && cat.label.trim() !== '';
        edit((w) => recut(anchorNames(w, kept), want, recutOptions()), { k: true });
      },

      rename(id, label) {
        const name = label.trim();
        const working = get().working;
        if (!working || !name) return;
        const same = (x: string) => x.trim().toLowerCase() === name.toLowerCase();
        const clash = working.categories.find((c) => c.id !== id && same(c.label));
        const yields = clash && !['edited', 'kept'].includes(sources.get(clash.id)?.source ?? 'kept');
        if (clash && !yields) {
          set({ notice: `Another category is already called "${clash.label}".` });
          return;
        }
        // A default name the player takes yields (it is proposed again elsewhere); the player's
        // own names, and an opened categorizer's, do not.
        const cleared = yields ? { ...working, categories: working.categories.map((c) => (c.id === clash.id ? { ...c, label: '' } : c)) } : working;
        if (edit(() => nameCategory(cleared, id, name))) {
          sources = new Map(sources).set(id, { source: 'edited', matched: null });
          showDoc(get().working!);
        }
      },

      moveHolds(ids, to) {
        return edit((w) => (to === NEW_CATEGORY && roomFor(w)) || moveHoldsIn(w, ids, to));
      },

      deleteHolds(ids) {
        return edit((w) => deleteHoldsFrom(w, ids));
      },

      merge(from, into) {
        return edit((w) => mergeCategories(w, from, into));
      },

      split(id) {
        return edit((w) => roomFor(w) ?? splitCategory(w, id));
      },

      undo() {
        const cur = get().working;
        const prev = undoStack.at(-1);
        if (!cur || !prev) return;
        undoStack = undoStack.slice(0, -1);
        redoStack = [...redoStack, { working: cur, sources }];
        lastWasK = false;
        sources = prev.sources;
        showDoc(prev.working, { dirty: true, notice: null });
      },

      redo() {
        const cur = get().working;
        const next = redoStack.at(-1);
        if (!cur || !next) return;
        redoStack = redoStack.slice(0, -1);
        undoStack = [...undoStack, { working: cur, sources }];
        lastWasK = false;
        sources = next.sources;
        showDoc(next.working, { dirty: true, notice: null });
      },

      async save(name) {
        const { view, phase, saving } = get();
        const trimmed = name.trim();
        if (!view || !trimmed || saving || view.k === 0) return false;
        if (phase !== 'carved' && phase !== 'saved') return false;
        const gen = generation;
        set({ saving: true });
        /** The stills this save filed (removed again if the record is not saved). */
        const filed: string[] = [];
        try {
          let categorizer: PersonalCategorizer;
          const working = get().working;
          const tuningAtStart = get().tuning;
          const checksAtStart = get().checks;
          if (working) categorizer = { ...working, name: trimmed };
          else return false;
          // Every hold's still taken this session, filed under its id once it is encoded (a Save
          // right after Stop must not file a categorizer whose pictures were still being taken).
          // Stills already filed (a saved base's) stay where they are.
          await stillsTaken();
          if (gen !== generation) return false;
          for (const x of categorizer.samples) {
            const still = stills.get(x.id);
            if (still && (await deps.thumbs.put(x.id, still).then(() => true, () => false))) filed.push(x.id);
          }
          // Saving under a name that already exists replaces that record: its stills go too,
          // unless another record (or this one) still names their holds.
          const before = new Map(
            (await Promise.all((await deps.models.list()).map((x) => deps.models.load(x.id))))
              .filter((r): r is FaceModelRecord => r !== null)
              .map((r) => [r.id, r.model.categorizer.samples.map((x) => x.id)]),
          );
          const tuning = get().tuning;
          const checks = get().checks;
          const hasChecks = checks.quiz !== undefined || checks.everyday !== undefined;
          const record = await deps.models.save(trimmed, { categorizer, ...(phase === 'saved' ? { tuning, ...(hasChecks ? { checks } : {}) } : {}) });
          const replaced = before.get(record.id);
          if (replaced) await dropStillsIfOrphaned(replaced);
          if (gen === generation) {
            // An edit made while the save was in flight (a correction, a tuning, a re-cut) is kept,
            // and still unsaved: what was saved is the state when Save was pressed.
            const changed = get().view !== view || get().tuning !== tuningAtStart || get().checks !== checksAtStart;
            set({ notice: `Saved "${record.name}".${changed ? ' Changes made since are not saved yet.' : ''}`, name: record.name, dirty: changed, ...(phase === 'saved' ? { openId: record.id, working: changed && get().working ? { ...get().working!, name: record.name } : record.model.categorizer } : {}) });
            if (phase === 'saved') openRecord = record;
          }
          await get().refreshSaved();
          return true;
        } catch (err) {
          // The record was not saved: the stills filed for it go again, unless a record names them.
          await dropStillsIfOrphaned(filed).catch(() => undefined);
          set({ notice: `Could not save: ${err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err)}` });
          return false;
        } finally {
          set({ saving: false });
        }
      },

      async refreshSaved() {
        const saved = await deps.models.list().catch(() => []);
        set({ saved });
      },

      async open(id) {
        const record = await deps.models.load(id);
        if (!record) {
          set({ notice: 'That categorizer could not be read.' });
          return;
        }
        get().reset();
        openRecord = record;
        showOpened(record.model.categorizer, { openId: id, name: record.name, hasStills: true, tuning: clampTuning(record.model.tuning ?? {}), checks: record.model.checks ?? {}, dirty: false });
      },

      async remove(id) {
        const record = await deps.models.load(id);
        await deps.models.remove(id);
        await dropStillsIfOrphaned(record?.model.categorizer.samples.map((x) => x.id) ?? []);
        if (get().openId === id) get().reset();
        await get().refreshSaved();
      },

      reset() {
        generation++;
        release();
        take = null;
        takeId = null;
        stilled = 0;
        burstStill = null;
        lastVector = null;
        fresh = null;
        baseRadius = undefined;
        sources = new Map();
        undoStack = [];
        redoStack = [];
        lastWasK = false;
        openRecord = null;
        mergeBase = null;
        shownIds = [];
        figureUrls.clear();
        stills.clear();
        pending.clear();
        dropUrls();
        clearStrip();
        set({ phase: 'idle', restProgress: null, restMoving: false, mirror: chosenMirror, vocabulary: chosenVocabulary, view: null, thumbs: {}, points: 0, hold: 'open', elapsed: 0, hasStills: false, openId: null, k: 0, notice: null, working: null, history: { undo: 0, redo: 0 }, tuning: DEFAULT_TUNING, checks: {}, dirty: false, merging: null, focus: null, holdsAs: null, burst: null, burstName: '' });
      },

      cancelRecording() {
        const merge = mergeBase;
        if (!isRecording(get().phase) || !merge) {
          if (isLive(get().phase)) get().reset();
          return;
        }
        // A merge take abandoned: back to the categorizer it was adding to, unsaved work and all.
        resetKeepingStills();
        openRecord = merge.record;
        restoreEdits(merge.edits);
        showDoc(merge.working, {
          phase: merge.phase,
          ...(merge.phase === 'carved' ? { hasStills: merge.hasStills } : {}),
          openId: merge.openId,
          name: merge.name,
          tuning: merge.tuning,
          checks: merge.checks,
          burstName: '',
          dirty: merge.dirty,
          notice: 'The take was stopped before it finished. Nothing was merged.',
        });
      },

      setTuning(tuning) {
        if (get().phase !== 'saved') return;
        const next = clampTuning({ ...get().tuning, ...tuning });
        const cur = get().tuning;
        if (sameTuning(next, cur)) return;
        set({ tuning: next, dirty: true });
      },

      setChecks(checks) {
        if (get().phase !== 'saved') return;
        set({ checks: { ...get().checks, ...checks }, dirty: true });
      },

      correct(id, vector) {
        const working = get().working;
        if (get().phase !== 'saved' || !working) return false;
        return edit((w) => addSample(w, id, modalityOnly(vector), { sampleId: holdId(freshTakeId(w.samples), 0), t: deps.now(), modality }));
      },

      move(index, to) {
        return edit((w) => moveSample(w, index, to));
      },

      startMerge(seed, options = {}) {
        const { phase, working, openId, name, tuning, checks, hasStills } = get();
        // A fresh carve too (#421): the same document, so the new holds are added to it, its
        // pins kept, and its first take's rest kept for the reject radius.
        if ((phase !== 'saved' && phase !== 'carved') || !working) return;
        mergeBase = { seed, phase, hasStills, working, record: openRecord, openId, name: options.name ?? name, tuning, checks, dirty: get().dirty, ...(options.holdsAs?.trim() ? { holdsAs: options.holdsAs.trim() } : {}), edits: { sources, undo: undoStack, redo: redoStack, baseRadius, fresh } };
        pauseOnCapture = false;
        get().start();
        // After the start (which resets): the take's bursts carry this name.
        set({ burstName: options.burstName ?? '', holdsAs: options.holdsAs?.trim() || null });
      },

      recordMore(id) {
        const { working, phase } = get();
        const cat = working?.categories.find((c) => c.id === id);
        if (!cat || !cat.label.trim() || (phase !== 'saved' && phase !== 'carved')) return false;
        get().startMerge('samples', { burstName: cat.label, holdsAs: cat.label });
        return isRecording(get().phase);
      },

      showOnBars(id) {
        const { working, view } = get();
        const hint = view?.hints.get(id);
        const cat = working?.categories.find((c) => c.id === id);
        if (!working || !hint || !cat) return false;
        const vectors = working.samples.map((x) => x.vector);
        const at = new Map(working.samples.map((x, i) => [x.id, i]));
        const centre = (ids: readonly string[]) => fullMean(vectors, ids.flatMap((x) => (at.has(x) ? [at.get(x)!] : [])));
        const other = hint.other === NEUTRAL_TARGET ? null : working.categories.find((c) => c.id === hint.other);
        const otherIds = other ? other.members : working.neutral;
        const otherLabel = other ? other.label || other.id : modality.words.neutral;
        const focus: BarFocus = {
          category: id,
          label: cat.label || cat.id,
          features: [...new Set(hint.movements.map((m) => m.feature))],
          marks: [
            { label: cat.label || cat.id, vector: centre(cat.members) },
            ...(otherIds.length > 0 ? [{ label: otherLabel, vector: centre(otherIds) }] : []),
          ],
        };
        if (!get().recordMore(id)) return false;
        pauseOnCapture = true;
        set({ focus });
        return true;
      },

      importFile(text) {
        const r = importCategorizer(text);
        if (!r.ok) {
          set({ notice: `Could not import: ${r.error}.` });
          return false;
        }
        const foreign = foreignModality(modality, r.categorizer);
        if (foreign) {
          set({ notice: `Could not import: this is ${foreign}.` });
          return false;
        }
        get().reset();
        const taken = get().saved.some((s) => s.name.trim().toLowerCase() === r.categorizer.name.trim().toLowerCase());
        showOpened(r.categorizer, {
          openId: null,
          name: r.categorizer.name,
          tuning: DEFAULT_TUNING,
          dirty: true,
          notice:
            `Imported "${r.categorizer.name}"${r.migratedFrom !== null ? ` (from file version ${r.migratedFrom})` : ''}. A file carries no pictures. Save to keep it` +
            (taken ? '; saving under the same name replaces the one you have.' : '.'),
        });
        return true;
      },

      exportFile(asked) {
        const { phase, working } = get();
        const given = asked?.trim() || get().name.trim();
        if ((phase !== 'saved' && phase !== 'carved') || !working) return null;
        const name = given || working.name || (modality.id === 'face' ? FACE_SESSION_DEFAULTS.exportName : `My ${modality.words.many}`);
        return { name, text: exportCategorizer({ ...working, name }) };
      },

      async exportSaved(id) {
        const record = await deps.models.load(id).catch(() => null);
        if (!record) {
          set({ notice: 'That categorizer could not be read.' });
          return null;
        }
        return { name: record.name, text: exportCategorizer({ ...record.model.categorizer, name: record.name }) };
      },

      async savedLabels(id) {
        const record = await deps.models.load(id).catch(() => null);
        return record ? record.model.categorizer.categories.map((c) => c.label) : null;
      },

      async importSaved(id, importer, confirm) {
        const record = await deps.models.load(id).catch(() => null);
        if (!record) {
          set({ notice: 'That categorizer could not be read.' });
          return false;
        }
        const entries = categoryEntries(record.model.categorizer);
        const taken = entries.filter((e) => importer.canonical(e.label) !== null);
        if (taken.length === 0) {
          set({ notice: `None of the categories of "${record.name}" is named as one of the ${importer.label} (${entries.map((e) => `"${e.label}"`).join(', ')}). Rename them first.` });
          return false;
        }
        const replaced = [...new Set(taken.filter((e) => importer.has(e.label)).map((e) => importer.canonical(e.label)!))];
        if (replaced.length > 0 && !confirm(`The ${importer.label} already have ${replaced.join(', ')}. Replace ${replaced.length === 1 ? 'it' : 'them'} with the ones from "${record.name}"?`)) return false;
        try {
          const r = await importer.import(entries, { hand: record.model.categorizer.hand ?? 'either' });
          const skipped = r.skipped.length > 0 ? ` Skipped ${r.skipped.map((l) => `"${l}"`).join(', ')} (not a name the ${importer.label} take, or too few samples).` : '';
          const warned = r.warnings.length > 0 ? ` Note: ${r.warnings.join('; ')}.` : '';
          set({ notice: r.imported.length > 0 ? `Now in the ${importer.label}: ${r.imported.join(', ')}.${skipped}${warned}` : `Nothing was imported.${skipped}` });
          return r.imported.length > 0;
        } catch (err) {
          set({ notice: `Could not import: ${err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err)}` });
          return false;
        }
      },

      async bindSaved(id, binder) {
        const record = await deps.models.load(id).catch(() => null);
        if (!record) {
          set({ notice: 'That categorizer could not be read.' });
          return false;
        }
        try {
          // By id (#371): the host reads the record itself, with its tuning, its modality and its hand.
          await binder.bind({ id: record.id });
          return true;
        } catch (e) {
          set({ notice: `Not bound: ${e instanceof Error ? e.message : String(e)}.` });
          return false;
        }
      },
    };
  });
  return store;
}

/** The rest frames' mean and standard deviation over `ids` (raw units): what the bars measure
 *  from, and the neutral band they draw. */
function restStats(vectors: readonly FeatureVector[], ids: readonly string[]): { mean: FeatureVector; spread: Record<string, number> } | null {
  if (vectors.length === 0) return null;
  const mean: FeatureVector = {};
  const spread: Record<string, number> = {};
  for (const id of ids) {
    const xs = vectors.map((v) => v[id]).filter((x): x is number => Number.isFinite(x));
    if (xs.length === 0) continue;
    const m = xs.reduce((a, x) => a + x, 0) / xs.length;
    mean[id] = m;
    spread[id] = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
  }
  return { mean, spread };
}
