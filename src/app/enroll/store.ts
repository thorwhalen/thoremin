/**
 * Trainer UI state (#160) — the store the enrollment panel binds to.
 *
 * Holds the {@link EnrollmentSession} (which owns the captured samples and the built
 * hierarchy) plus the small amount of state that is genuinely about the UI: which step
 * is running, how many categories the player has asked for, and what they have named
 * them.
 *
 * ## Two things this store deliberately does NOT do
 *
 * - **It does not sample.** The panel polls {@link readLiveVector} on a timer while a
 *   step runs and calls {@link TrainerState.sample}. Putting the poll in the store would
 *   make it own a timer, which makes it untestable without fake timers and couples it to
 *   a rendering lifecycle it should not know about.
 * - **It does not touch sound.** A trained model here changes nothing about what you
 *   hear. Binding a category to a dial or a command is a separate, later decision (open
 *   question 3 on the issue) and will go through the #127 command path like every other
 *   write. Keeping that out means a bad training run cannot break the instrument.
 *
 * `retrain(k)` is cheap by construction — it re-cuts the built hierarchy rather than
 * reclustering — which is what lets the k control be a live slider rather than a button.
 */
import { create } from 'zustand';
import { FEATURE_GROUP_IDS } from '@/features/catalog';
import { appFeatureDemand } from '../featureDemand';
import {
  createEnrollmentSession,
  type EnrollmentSession,
  type FeatureVector,
  type StepId,
  type StepProgress,
  type TrainedModel,
} from '@/enroll';

interface TrainerState {
  /** The step currently capturing, or null. */
  activeStep: StepId | null;
  /** Per-step sample counts + coverage, refreshed as samples arrive. */
  progress: StepProgress[];
  /** True once `build()` has run and a model can be cut. */
  built: boolean;
  /** How many categories the player has asked for. */
  k: number;
  /** The heuristic's suggestion — shown as a hint, never imposed. */
  suggestedK: number;
  /** The most recent cut. */
  model: TrainedModel | null;
  /** Player-supplied names, by category id. Kept out of the model so a re-cut at a
   *  different k cannot silently reattach a name to a different cluster. */
  labels: Record<string, string>;

  begin(step: StepId): void;
  sample(vector: FeatureVector, tMs: number): void;
  end(): void;
  build(): void;
  setK(k: number): void;
  setLabel(id: string, label: string): void;
  reset(): void;
  /** Escape hatch for tests and for a future "export my training take". */
  session(): EnrollmentSession;
}

/** The session lives outside the store: it is a mutable capture buffer, not UI state,
 *  and putting it in the store would invite React to try to diff it. */
let session: EnrollmentSession = createEnrollmentSession();

/** The trainer's claim on the feature-demand registry while a step runs. */
const DEMAND_OWNER = 'trainer';

export const useTrainer = create<TrainerState>()((set, get) => ({
  activeStep: null,
  progress: session.progress(),
  built: false,
  k: 3,
  suggestedK: 3,
  model: null,
  labels: {},

  begin(step) {
    session.beginStep(step);
    // Ask the engine to compute the catalog while the step runs (#163): with the Lab
    // closed the vector nodes otherwise emit `{}`, and the step captures nothing.
    appFeatureDemand.claim(DEMAND_OWNER, FEATURE_GROUP_IDS);
    set({ activeStep: step, progress: session.progress() });
  },

  sample(vector, tMs) {
    if (!get().activeStep) return;
    session.push(vector, tMs);
    set({ progress: session.progress() });
  },

  end() {
    session.endStep();
    appFeatureDemand.release(DEMAND_OWNER);
    set({ activeStep: null, progress: session.progress() });
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
    session = createEnrollmentSession();
    appFeatureDemand.release(DEMAND_OWNER);
    set({
      activeStep: null,
      progress: session.progress(),
      built: false,
      k: 3,
      suggestedK: 3,
      model: null,
      labels: {},
    });
  },

  session: () => session,
}));
