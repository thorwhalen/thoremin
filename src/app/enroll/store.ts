/**
 * Trainer UI state (#160, reworked for #163) — the store the trainer panel binds to.
 *
 * Holds the {@link Runner} + {@link Session} pair (which own the captured samples, the
 * conversation and the built hierarchy) plus the state that is genuinely about the
 * UI: which routine is loaded, where the runner is, what it last said, how many
 * categories the player asked for and what they named them.
 *
 * ## Three things this store deliberately does NOT do
 *
 * - **It does not sample.** The panel polls {@link readLiveVector} on a timer while the
 *   runner runs and calls {@link TrainerState.sample} / {@link TrainerState.tick}.
 *   Putting the poll in the store would make it own a timer, which makes it untestable
 *   without fake timers and couples it to a rendering lifecycle it should not know
 *   about.
 * - **It does not touch sound.** A trained model here changes nothing about what you
 *   hear. Binding a category to a dial or a command is a separate, later decision and
 *   will go through the #127 command path like every other write. Keeping that out
 *   means a bad training run cannot break the instrument.
 * - **It does not speak.** Everything the runner says arrives as a `say` string in
 *   {@link TrainerState.say} and the transcript; the panel shows it as text, and the
 *   voice layer (#163 §4) plays the cached clip for the same string. One channel of
 *   content, two renderings.
 *
 * ## Feature demand
 *
 * While a routine runs, the store CLAIMS the union of its cues' feature groups on the
 * app's feature-demand registry, so the engine computes them whether or not the Lab
 * is open (and loads the face model if a face group is among them). Released on stop,
 * done and reset.
 *
 * `retrain(k)` is cheap by construction — it re-cuts the built hierarchy rather than
 * reclustering — which is what lets the k control be a live slider rather than a button.
 */
import { create } from 'zustand';
import {
  categoryKey,
  createRunner,
  createSession,
  fitProjection,
  MIN_POINTS_FOR_PROJECTION,
  resolveRoutine,
  routineGroups,
  type Cue,
  type CueOutcome,
  type FeatureVector,
  type Runner,
  type RunnerEvent,
  type RunnerStatus,
  type Point2,
  type Projection,
  type Session,
  type TrainedModel,
  type Verdict,
} from '@/enroll';
import { appFeatureDemand } from '../featureDemand';
import { createCueStore, createRoutineStore, listCues, loadRoutine, type CueStore, type RoutineStore } from './cueStore';
import { createTrainerTagSource, type TrainerTagSource } from './annotations';
import { recordingController } from '../recording/controller';
import { useTrainerPrefs } from './prefs';
import { TRAINER_TAKE_INSTRUMENT, trainerTakeSession } from './takeSession';
import { parseSession, RECORDING_SESSION_KEY } from '../recording/schema';
import { emitGuidance, emitGuidanceStop } from './guidance';
import { DEFAULT_ROUTINE_CUE_IDS, STARTER_CUES } from './starterCues';

/** One line of what the runner said, for the panel's transcript. */
export interface TranscriptLine {
  t: number;
  kind: 'instruction' | 'guidance' | 'end' | 'done';
  say: string;
  /** For `end`: the outcome, and the written detail when it was `cannot`. */
  outcome?: CueOutcome;
  why?: string;
}

/** How many transcript lines the panel keeps. */
const TRANSCRIPT_LIMIT = 40;

interface TrainerState {
  /** Every cue known (starters + stored), for the picker. */
  cues: Cue[];
  /** The routine to run, in order. */
  routine: Cue[];
  routineName: string;
  /** Cue ids the routine named that no longer exist. */
  missing: string[];
  /** True once the stores have been read. */
  loaded: boolean;

  status: RunnerStatus;
  /** Index of the active cue in `routine`, or -1. */
  index: number;
  samples: number;
  coverage: number;
  verdict: Verdict | null;
  /** What the runner last said — the line the panel shows large. */
  say: string | null;
  outcomes: (CueOutcome | null)[];
  transcript: TranscriptLine[];
  /** What the runner said when the LAST cue ended ("Good." / "Moving on."), or null
   *  after a skip — what the beat shows. Not "the last end line in the transcript":
   *  a skip says nothing, and the previous cue's phrase must not be shown for it. */
  lastEndSay: string | null;

  /** True once `build()` has run and a model can be cut. */
  built: boolean;
  k: number;
  suggestedK: number;
  model: TrainedModel | null;
  /**
   * Player-supplied names, keyed by {@link categoryKey} (the category's MEMBER SET),
   * not by its positional id: `cat-2` at k=3 is a different cluster from `cat-2` at
   * k=4, but a name belongs to a set of held poses. Re-cutting keeps every name whose
   * cluster survived the cut intact, and silently attaches none to a different one.
   */
  labels: Record<string, string>;

  /** Stored cues dropped on load because none of their groups exists in the catalog
   *  (such a cue could never capture anything; see `cueStore.listCues`). */
  unusable: string[];

  /**
   * The 2-D layout of the built take's still-points (#163 §7), or null. Kept so the
   * projection view can draw it and place a live cursor; the labelling below carves
   * categories from the SELECTED indices, in full feature space.
   */
  projection: Projection | null;
  /** One [x, y] per still-point (mirrors `projection.layout`, for React). */
  layout: Point2[];
  /** The indices the player has selected in the picture (the working set). */
  selection: number[];
  /**
   * Player-labelled groups: a name + the still-point indices they selected. This is
   * the ALTERNATIVE to the k-cut (#163 §8) — a partition the player drew, from which
   * `modelFor` builds categories in full feature space.
   */
  labelGroups: { name: string; members: number[] }[];

  /** Saved routines (metadata), newest first — for the picker. */
  savedRoutines: { id: string; name: string }[];
  /** True while this routine's take is being RECORDED (#163 §6). */
  recording: boolean;

  /** Read the cue + routine stores (idempotent; the panel calls it on open). */
  load(): Promise<void>;
  /** Replace the routine with these cue ids (resolved against `cues`). */
  setRoutine(cueIds: readonly string[], name?: string): void;
  /** Persist the current routine (or `cueIds`) under `name`, and use it. */
  saveRoutine(name: string, cueIds?: readonly string[]): Promise<void>;
  /** Load a saved routine by id and use it (a missing id falls back to the default). */
  useRoutine(id: string | null): Promise<void>;
  /** Delete a saved routine. */
  removeRoutine(id: string): Promise<void>;
  start(tMs: number): void;
  /**
   * Start the routine, recording the take first when the `recordTake` pref is on:
   * the recorder's `t0` must exist before the first cue's annotation. `now` is read
   * AFTER the recorder has started (it takes a moment), so the runner's clock and the
   * take's share an origin. Resolves once the routine is running.
   */
  startTake(now: () => number): Promise<void>;
  sample(vector: FeatureVector, tMs: number): void;
  tick(tMs: number): void;
  skip(tMs: number): void;
  stop(tMs: number): void;
  build(): void;
  /** Lay the built take out in 2-D (UMAP over the model metric). No-op if too small. */
  project(): void;
  /** The live cursor's position in the current layout, or null. */
  cursorAt(vector: FeatureVector): Point2 | null;
  /** Replace the current selection (indices into the layout). */
  select(indices: readonly number[]): void;
  /** Turn the current selection into a labelled group (or extend one of that name),
   *  then rebuild the model from the player's groups in FULL feature space. */
  labelSelection(name: string): void;
  /** Remove a labelled group by name. */
  removeLabelGroup(name: string): void;
  setK(k: number): void;
  /** Name a category, by its stable key (see `labels`). */
  setLabel(key: string, label: string): void;
  reset(): void;
  /** Escape hatches for tests and for a future "export my training take". */
  session(): Session;
  runner(): Runner | null;
}

/** Build a model + its labels from the player's drawn groups: each group's members are
 *  a cluster, `modelFor` computes the centroid in FULL feature space, and the name is
 *  attached by the category's stable member-set key. An empty set clears the model. */
function modelFromGroups(groups: { name: string; members: number[] }[]): { model: TrainedModel | null; labels: Record<string, string> } {
  if (groups.length === 0) return { model: null, labels: {} };
  const model = session.modelFor(groups.map((g) => g.members));
  const labels: Record<string, string> = {};
  model.categories.forEach((c, i) => {
    labels[categoryKey(c)] = groups[i]?.name ?? '';
  });
  return { model, labels };
}

/** The capture objects live outside the store: mutable buffers, not UI state. */
let session: Session = createSession();
let runner: Runner | null = null;
/** Detach the store from the current runner, so a replaced runner cannot keep writing. */
let unsubscribe: (() => void) | null = null;

/** The stores (localStorage by default). Swappable for tests via {@link useTrainerStores}. */
let stores: { cues: CueStore; routines: RoutineStore } | null = null;
const getStores = () => (stores ??= { cues: createCueStore(), routines: createRoutineStore() });

/** Test hook: retarget the persistence (in-memory providers) and forget any loaded state. */
export function useTrainerStores(next: { cues: CueStore; routines: RoutineStore } | null): void {
  stores = next;
  useTrainer.setState({ loaded: false });
}

/** The trainer's claim on the feature-demand registry while a routine runs. */
const DEMAND_OWNER = 'trainer';

/** The annotation source for the running take (created per start). */
let tagSource: TrainerTagSource | null = null;
/** The player's last Record-sheet config (for the take's location / fps / formats),
 *  or the defaults. Read fresh at each start; localStorage may be absent in tests. */
function playerRecordingBase() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECORDING_SESSION_KEY) : null;
    return parseSession(raw ? JSON.parse(raw) : null);
  } catch {
    return parseSession(null);
  }
}

/** True during the controller-start await window, so a second Start (the button is
 *  still rendered while `status` is 'idle' during that await) cannot re-enter. */
let takeStarting = false;

/** Reconcile the store's `recording` flag with the controller: another surface (the
 *  Record HUD's Stop) can end the take without the trainer knowing, and a stale REC dot
 *  would keep pulsing. Called on every poll. */
function reconcileRecording(get: () => { recording: boolean }, set: (s: { recording: boolean }) => void): void {
  if (get().recording && !recordingController().isRecording()) {
    tagSource = null;
    set({ recording: false });
  }
}

/** Stop a running take (if any) and forget its annotation source. */
async function endTake(set: (s: { recording: boolean }) => void): Promise<void> {
  const wasRecording = useTrainer.getState().recording;
  tagSource = null;
  if (!wasRecording) return;
  set({ recording: false });
  await recordingController().stop();
}

const IDLE = {
  status: 'idle' as RunnerStatus,
  index: -1,
  samples: 0,
  coverage: 0,
  verdict: null as Verdict | null,
  say: null as string | null,
};

export const useTrainer = create<TrainerState>()((set, get) => {
  const fromRunner = () => {
    if (!runner) return IDLE;
    const s = runner.state();
    return { status: s.status, index: s.index, samples: s.samples, coverage: s.coverage, verdict: s.verdict, say: s.say };
  };

  const onEvent = (e: RunnerEvent) => {
    const push = (line: TranscriptLine) => {
      set((st) => ({ transcript: [...st.transcript, line].slice(-TRANSCRIPT_LIMIT) }));
      // Sinks run AFTER the runner's dispatch and the store's update have settled: a
      // sink that reacts by skipping or stopping must not re-enter the runner mid-event.
      queueMicrotask(() => emitGuidance(line));
    };
    switch (e.type) {
      case 'cue-start':
        push({ t: e.t, kind: 'instruction', say: e.say });
        break;
      case 'guidance':
        push({ t: e.t, kind: 'guidance', say: e.say });
        break;
      case 'cue-end':
        // A skip says nothing; only an outcome with a phrase is a line of transcript.
        if (e.say) push({ t: e.t, kind: 'end', say: e.say, outcome: e.outcome, why: e.why });
        set({ outcomes: runner?.state().outcomes ?? [], lastEndSay: e.say ?? null });
        break;
      case 'done':
        push({ t: e.t, kind: 'done', say: e.say });
        appFeatureDemand.release(DEMAND_OWNER);
        void endTake(set);
        break;
      case 'stopped':
        appFeatureDemand.release(DEMAND_OWNER);
        void endTake(set);
        // After any say already queued in a microtask (a tick then a stop in one turn).
        queueMicrotask(() => emitGuidanceStop());
        break;
    }
  };

  /** The runner's events, to the take's annotation stream (when one is running). */
  const onEventForTake = (e: RunnerEvent) => tagSource?.onEvent(e);

  return {
    cues: [...STARTER_CUES],
    routine: [...STARTER_CUES],
    routineName: 'Default',
    missing: [],
    unusable: [],
    savedRoutines: [],
    projection: null,
    layout: [],
    selection: [],
    labelGroups: [],
    recording: false,
    loaded: false,
    ...IDLE,
    outcomes: STARTER_CUES.map(() => null),
    transcript: [],
    lastEndSay: null,
    built: false,
    k: 3,
    suggestedK: 3,
    model: null,
    labels: {},

    async load() {
      if (get().loaded) return;
      const { cues: cueStore, routines } = getStores();
      const { cues, unusable } = await listCues(cueStore);
      const r = await loadRoutine(null, cues, routines);
      // A routine may be running by the time the stores answer (Start pressed before
      // the read resolved): the runner holds ITS cue list, and the panel renders the
      // store's — they must not diverge mid-run. Swap the routine only when idle.
      const running = get().status === 'running' || get().status === 'between';
      const savedRoutines = (await routines.list()).map(({ id, name }) => ({ id, name }));
      set(
        running
          ? { cues, unusable, savedRoutines, loaded: true }
          : { cues, unusable, savedRoutines, routine: r.cues, routineName: r.name, missing: r.missing, outcomes: r.cues.map(() => null), loaded: true },
      );
    },

    async saveRoutine(name, cueIds) {
      const ids = cueIds ?? get().routine.map((c) => c.id);
      // Hydrate first, persist after (the project's hot-path rule): the routine in use
      // must not lag a slow provider, and Start must never run the pre-save one.
      get().setRoutine(ids, name.trim() || 'Custom');
      const { routines } = getStores();
      await routines.save(name, { cueIds: [...new Set(ids)] });
      const savedRoutines = (await routines.list()).map(({ id, name: n }) => ({ id, name: n }));
      set({ savedRoutines });
    },

    async useRoutine(id) {
      if (get().status === 'running' || get().status === 'between') return;
      const { routines } = getStores();
      const r = await loadRoutine(id, get().cues, routines);
      set({ routine: r.cues, routineName: r.name, missing: r.missing, outcomes: r.cues.map(() => null) });
    },

    async removeRoutine(id) {
      const { routines } = getStores();
      await routines.remove(id);
      const savedRoutines = (await routines.list()).map(({ id: i, name }) => ({ id: i, name }));
      set({ savedRoutines });
    },

    setRoutine(cueIds, name = 'Custom') {
      // Not while a runner is driving the current routine (same reason as in load()).
      if (get().status === 'running' || get().status === 'between') return;
      // The same resolution the routine collection uses: unknown ids reported, a
      // repeated id runs once.
      const { cues: routine, missing } = resolveRoutine(cueIds, get().cues);
      set({ routine, routineName: name, missing, outcomes: routine.map(() => null) });
    },

    start(tMs) {
      const routine = get().routine;
      set({ lastEndSay: null });
      // A previous runner (a re-run, or a test driving the store directly) must be
      // stopped and detached first, or it stays 'running' on an orphaned session and
      // keeps writing events into this store.
      unsubscribe?.();
      unsubscribe = null;
      runner?.stop(tMs);
      session = createSession();
      runner = createRunner({ cues: routine, session });
      const offEvents = runner.subscribe(onEvent);
      const offTake = runner.subscribe(onEventForTake);
      unsubscribe = () => {
        offEvents();
        offTake();
      };
      appFeatureDemand.claim(DEMAND_OWNER, routineGroups(routine));
      set({ transcript: [], outcomes: routine.map(() => null), built: false, model: null, labels: {} });
      runner.start(tMs);
      set(fromRunner());
    },

    async startTake(now) {
      const { status, recording } = get();
      // Not while a routine runs, a take records, or a start is mid-flight (the Start
      // button stays rendered during the controller-start await, when status is still
      // 'idle') — a second call would orphan the recorder and lose the annotations.
      if (takeStarting || recording || status === 'running' || status === 'between') return;
      takeStarting = true;
      try {
        if (useTrainerPrefs.getState().recordTake) {
          const routine = get().routine;
          tagSource = createTrainerTagSource({ active: () => true, cues: () => routine });
          const ok = await recordingController().start(trainerTakeSession(playerRecordingBase()), {
            tagSource,
            instrument: TRAINER_TAKE_INSTRUMENT,
          });
          set({ recording: ok });
          if (!ok) tagSource = null;
        }
        get().start(now());
      } finally {
        takeStarting = false;
      }
    },

    sample(vector, tMs) {
      if (!runner) return;
      runner.push(vector, tMs);
      reconcileRecording(get, set);
      set(fromRunner());
    },

    tick(tMs) {
      if (!runner) return;
      runner.tick(tMs);
      reconcileRecording(get, set);
      set(fromRunner());
    },

    skip(tMs) {
      runner?.skip(tMs);
      set(fromRunner());
    },

    stop(tMs) {
      runner?.stop(tMs);
      appFeatureDemand.release(DEMAND_OWNER);
      set(fromRunner());
    },

    build() {
      session.build();
      const suggested = session.suggestedK();
      const k = suggested > 0 ? suggested : get().k;
      set({ built: true, suggestedK: suggested, k, model: session.retrain(k), projection: null, layout: [], selection: [], labelGroups: [] });
    },

    project() {
      if (!get().built) return;
      const pts = session.points();
      if (pts.length < MIN_POINTS_FOR_PROJECTION) {
        set({ projection: null, layout: [] });
        return;
      }
      const proj = fitProjection(pts, session.features(), session.weights());
      set({ projection: proj, layout: proj.layout, selection: [] });
    },

    cursorAt(vector) {
      const proj = get().projection;
      return proj ? proj.transform(vector) : null;
    },

    select(indices) {
      const n = session.points().length;
      set({ selection: [...new Set(indices)].filter((i) => i >= 0 && i < n).sort((a, b) => a - b) });
    },

    labelSelection(name) {
      const trimmed = name.trim();
      const sel = get().selection;
      if (!trimmed || sel.length === 0) return;
      // A point belongs to exactly one group: adding it here removes it from any other,
      // so the groups stay a PARTITION (what `modelFor` expects).
      const others = get().labelGroups
        .filter((g) => g.name !== trimmed)
        .map((g) => ({ name: g.name, members: g.members.filter((i) => !sel.includes(i)) }))
        .filter((g) => g.members.length > 0);
      const existing = get().labelGroups.find((g) => g.name === trimmed)?.members ?? [];
      const merged = [...new Set([...existing.filter((i) => !sel.includes(i)), ...sel])].sort((a, b) => a - b);
      const labelGroups = [...others, { name: trimmed, members: merged }];
      set({ labelGroups, selection: [], ...modelFromGroups(labelGroups) });
    },

    removeLabelGroup(name) {
      const labelGroups = get().labelGroups.filter((g) => g.name !== name);
      set({ labelGroups, ...modelFromGroups(labelGroups) });
    },

    setK(k) {
      if (!get().built) {
        set({ k });
        return;
      }
      set({ k, model: session.retrain(k) });
    },

    setLabel(key, label) {
      set((s) => ({ labels: { ...s.labels, [key]: label } }));
    },

    reset() {
      unsubscribe?.();
      unsubscribe = null;
      runner = null;
      session = createSession();
      appFeatureDemand.release(DEMAND_OWNER);
      void endTake(set);
      set({
        ...IDLE,
        outcomes: get().routine.map(() => null),
        transcript: [],
        lastEndSay: null,
        projection: null,
        layout: [],
        selection: [],
        labelGroups: [],
        built: false,
        k: 3,
        suggestedK: 3,
        model: null,
        labels: {},
      });
    },

    session: () => session,
    runner: () => runner,
  };
});

export { DEFAULT_ROUTINE_CUE_IDS };
