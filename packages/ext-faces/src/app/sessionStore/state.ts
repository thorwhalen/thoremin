/**
 * The face session store's shape (#330, #385): its phases, its injected dependencies
 * ({@link FaceSessionDeps}), the state a panel renders ({@link FaceSessionState}) and its
 * defaults. Moved out of `../sessionStore.ts`, which re-exports all of it; the store itself
 * (`createFaceSessionStore`) stays there.
 */
import { MAX_CATEGORIZER_SAMPLES, type CategorizerStrangers, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { ForestPrefetcher, MergeRunner } from '../../lib/forest_prefetch';
import type { Place } from '@thoremin/sdk/enroll/sorting';
import type { NamedCollectionStore, NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import type { NameSources, SortingView } from '../../lib/carving';
import type { Tuning } from '@thoremin/sdk/enroll/live';
import type { HoldState } from '../../lib/take';
import type { CarveModality, HandChoice } from '@thoremin/sdk/enroll/modality';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { BarMark, LiveBars } from '@thoremin/sdk/enroll/bars';
import type { CarveCaptureControl } from '@thoremin/sdk-ui/enroll/capture';
import type { CarveModalityUi } from '@thoremin/sdk-ui/enroll/modality';
import type { CategoryBinder } from '@thoremin/sdk-ui/enroll/binder';
import type { CategorizerChecks, FaceModelRecord, SavedFaceModel } from '../models';
import type { FaceSource } from '../sources';
import type { FrameOpener, ThumbStore } from '../thumbnails';
import type { VocabularyImporter } from '@thoremin/sdk-ui/enroll/vocabularyImport';
import { MAX_CATEGORY_SLOTS } from '../../schema';

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
  /** Warms the re-cut forest off the main thread for a big categorizer (#499); none: it is built on the page. */
  forests?: ForestPrefetcher;
  /** Merges a take into a big categorizer off the main thread (#587); none: `mergeSession` runs on the page. */
  merge?: MergeRunner;
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
  /** Whether the room reads as too dark to carve in (#348); a status line, never a modal. */
  tooDark: boolean;
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
  beginBurst(lean?: boolean): void;
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
  setRadiusFrom(from: 'holds' | 'frames'): boolean; // radii from the holds' frames too (#413), undoable
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
  /** Merge category `from` into `into` (both's holds pinned to `into`); `into` may be the Neutral
   *  bin (`NEUTRAL_BIN`): the category is dropped, its holds pinned in Neutral (#444). */
  merge(from: string, into: string): boolean;
  /** Split a category in two (its own sub-hierarchy cut at 2, both halves pinned). */
  split(id: string): boolean;
  /** Step the working categorizer back to before the last edit (exactly), or forward again. */
  undo(): void;
  redo(): void;
  /** Record a new take and merge it into the working categorizer (P1's `mergeSession`): the open
   *  one, or a fresh carve before it is saved (#421); `burstName` names its bursts ("Record more
   *  frown"); `name` is the Save field's text, there again when the take returns; `holdsIn`
   *  (a category id) takes every hold the take makes that is not named otherwise, pinned (#435:
   *  "Record more" for one category; by id, so a category named like a bin is still that category). */
  startMerge(seed: MergeSeed, options?: { burstName?: string; name?: string; holdsIn?: string }): void;
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
   *  #420: about 0.13 s at 800 holds over 52 features, 0.75 s at 2000; past this the worker builds it). */
  suggestUpTo: 800,
  /** The most holds a re-cut carves at once on the main thread: the file's bound (about 0.8 s
   *  at 3000, #587: the forest is built in the worker). Only a record saved before the bound existed can be larger. */
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
  /** How often the room's light is read from the live frame (#348), ms. */
  lightMs: 1000,
  /** A movement in the rest must last this long to say "stay relaxed", ms (a blink is shorter). */
  restMovingForMs: 300,
  /** "Stay relaxed" stays up this long after the last movement, ms, so it does not flicker. */
  restMovingHoldMs: 1000,
} as const;

/** A fresh take's rest while its carve is shown: its frames, and the rest cloud by hold id. */
export type FreshTake = { rest: readonly FeatureVector[]; cloud: ReadonlySet<string> | null };

/** One step of the edit history: the working categorizer and how its names came about. */
export interface Snapshot {
  working: PersonalCategorizer;
  sources: NameSources;
}
