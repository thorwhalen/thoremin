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
  createRunner,
  createSession,
  routineGroups,
  type Cue,
  type CueOutcome,
  type FeatureVector,
  type Runner,
  type RunnerEvent,
  type RunnerStatus,
  type Session,
  type TrainedModel,
  type Verdict,
} from '@/enroll';
import { appFeatureDemand } from '../featureDemand';
import { createCueStore, createRoutineStore, listCues, loadRoutine, type CueStore, type RoutineStore } from './cueStore';
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

  /** True once `build()` has run and a model can be cut. */
  built: boolean;
  k: number;
  suggestedK: number;
  model: TrainedModel | null;
  /** Player-supplied names, by category id. Kept out of the model so a re-cut at a
   *  different k cannot silently reattach a name to a different cluster. */
  labels: Record<string, string>;

  /** Read the cue + routine stores (idempotent; the panel calls it on open). */
  load(): Promise<void>;
  /** Replace the routine with these cue ids (resolved against `cues`). */
  setRoutine(cueIds: readonly string[], name?: string): void;
  start(tMs: number): void;
  sample(vector: FeatureVector, tMs: number): void;
  tick(tMs: number): void;
  skip(tMs: number): void;
  stop(tMs: number): void;
  build(): void;
  setK(k: number): void;
  setLabel(id: string, label: string): void;
  reset(): void;
  /** Escape hatches for tests and for a future "export my training take". */
  session(): Session;
  runner(): Runner | null;
}

/** The capture objects live outside the store: mutable buffers, not UI state. */
let session: Session = createSession();
let runner: Runner | null = null;

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
    const push = (line: TranscriptLine) =>
      set((st) => ({ transcript: [...st.transcript, line].slice(-TRANSCRIPT_LIMIT) }));
    switch (e.type) {
      case 'cue-start':
        push({ t: e.t, kind: 'instruction', say: e.say });
        break;
      case 'guidance':
        push({ t: e.t, kind: 'guidance', say: e.say });
        break;
      case 'cue-end':
        push({ t: e.t, kind: 'end', say: e.say ?? '', outcome: e.outcome, why: e.why });
        set({ outcomes: runner?.state().outcomes ?? [] });
        break;
      case 'done':
        push({ t: e.t, kind: 'done', say: e.say });
        appFeatureDemand.release(DEMAND_OWNER);
        break;
      case 'stopped':
        appFeatureDemand.release(DEMAND_OWNER);
        break;
    }
  };

  return {
    cues: [...STARTER_CUES],
    routine: [...STARTER_CUES],
    routineName: 'Default',
    missing: [],
    loaded: false,
    ...IDLE,
    outcomes: STARTER_CUES.map(() => null),
    transcript: [],
    built: false,
    k: 3,
    suggestedK: 3,
    model: null,
    labels: {},

    async load() {
      if (get().loaded) return;
      const { cues: cueStore, routines } = getStores();
      const cues = await listCues(cueStore);
      const r = await loadRoutine(null, cues, routines);
      set({ cues, routine: r.cues, routineName: r.name, missing: r.missing, outcomes: r.cues.map(() => null), loaded: true });
    },

    setRoutine(cueIds, name = 'Custom') {
      const byId = new Map(get().cues.map((c) => [c.id, c]));
      const routine: Cue[] = [];
      const missing: string[] = [];
      for (const id of cueIds) {
        const c = byId.get(id);
        if (c) routine.push(c);
        else missing.push(id);
      }
      set({ routine, routineName: name, missing, outcomes: routine.map(() => null) });
    },

    start(tMs) {
      const routine = get().routine;
      session = createSession();
      runner = createRunner({ cues: routine, session });
      runner.subscribe(onEvent);
      appFeatureDemand.claim(DEMAND_OWNER, routineGroups(routine));
      set({ transcript: [], outcomes: routine.map(() => null), built: false, model: null, labels: {} });
      runner.start(tMs);
      set(fromRunner());
    },

    sample(vector, tMs) {
      if (!runner) return;
      runner.push(vector, tMs);
      set(fromRunner());
    },

    tick(tMs) {
      if (!runner) return;
      runner.tick(tMs);
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
      set({ built: true, suggestedK: suggested, k, model: session.retrain(k) });
    },

    setK(k) {
      if (!get().built) {
        set({ k });
        return;
      }
      set({ k, model: session.retrain(k) });
    },

    setLabel(id, label) {
      set((s) => ({ labels: { ...s.labels, [id]: label } }));
    },

    reset() {
      runner = null;
      session = createSession();
      appFeatureDemand.release(DEMAND_OWNER);
      set({
        ...IDLE,
        outcomes: get().routine.map(() => null),
        transcript: [],
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
