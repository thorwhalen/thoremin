/**
 * Testing a face categorizer live (#330 P3): the player makes faces and sees what the
 * categorizer reads (which category, the memberships, "none of these"), under the tuning they
 * are setting. A zustand store the panel renders, with its dependencies injected like the
 * session's (`./sessionStore.ts`), so a test drives it with the synthetic face.
 *
 * The hot-path split: the poll reads the live vector at frame rate and feeds the reader (its
 * hysteresis needs every frame); the store is told at most every `publishMs`, or at once when
 * the settled category changes (what a person can see change).
 *
 * While testing it claims the face feature groups and hushes the instrument under its own owner
 * (`faces-test`), not the session's, so ending a test never releases a recording's claim.
 *
 * Two checks ride on the same readings (#385 E7): the **quiz** (each category asked in turn: hit,
 * slow or miss, `@thoremin/sdk/enroll/quiz`) and the **everyday check** (a minute of doing nothing
 * in particular, counting accidental fires, `@thoremin/sdk/enroll/everyday`). Each is fed the
 * settled reading every frame (a frame with no face reads as none, so a prompt still times out);
 * its result goes to the `onDone` the caller passes (the panel keeps it with the categorizer).
 *
 * The categorizer's moving gestures (#954) are heard on the same projected frames by a gesture
 * listener (`createGestureListener`, as the host's dispatcher hears a bound set's, at the frame's
 * own stamp), made once per gestures section (`LiveModel.gestures` keeps its identity across a
 * tuning change, so a slider does not restart its warm-up). Trying shows each gesture's fires and
 * says while the listener warms; the quiz asks the gestures too and takes a fire as the answer
 * (`Quiz.fire`, a movement under way holding the deadline); the everyday check counts every
 * fire (`EverydayCheck.fire`).
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { createQuiz, quizOrder, type Quiz, type QuizOptions, type QuizStep, type QuizTrial } from '@thoremin/sdk/enroll/quiz';
import { createEverydayCheck, EVERYDAY_DEFAULTS, type EverydayCheck } from '@thoremin/sdk/enroll/everyday';
import { checkTargets, createLiveReader, type LiveModel, type LiveReader, type LiveReading } from '@thoremin/sdk/enroll/live';
import { createGestureListener, type GestureListener, type GestureModel } from '@thoremin/sdk/enroll/gestures';
import type { FaceSource } from './sources';
import type { FrameOpener, LiveFrames } from './thumbnails';
import { createLightWatch } from './sessionWatches';

export interface FaceTestDeps {
  source: () => FaceSource;
  /** Claim (true) or release the face features and the instrument's quiet. */
  claim: (on: boolean) => void;
  /** Engine-clock ms. */
  now: () => number;
  pollMs: number;
  publishMs: number;
  /** Opens the source's stream to read the room's light from (#348); absent: no warning. */
  frames?: FrameOpener;
  /** Where the part sits in a frame, for the light reading's crop (the session's `region`). */
  region?: Parameters<typeof createLightWatch>[1]['region'];
  /** The listener a categorizer's gestures are heard with (`createGestureListener` by default). */
  listen?: (model: GestureModel) => GestureListener;
}

export const FACE_TEST_DEFAULTS = {
  /** How often the room's light is read (ms): the session's own cadence. */
  lightMs: 1000,
  pollMs: 33,
  publishMs: 100,
  /** Frames averaged into a correction ("this face is X"): about a quarter second. */
  captureFrames: 8,
} as const;

/** The quiz as the panel shows it. */
export interface QuizView {
  step: QuizStep;
  trials: readonly QuizTrial[];
}

/** The everyday check as the panel shows it. */
export interface EverydayView {
  elapsedMs: number;
  durationMs: number;
  fires: Readonly<Record<string, number>>;
  done: boolean;
}

export interface QuizStart extends QuizOptions {
  /** The order to ask in (a random one, each category twice, by default). */
  order?: readonly string[];
  /** Told the trials once every prompt is answered (not when stopped early). */
  onDone?: (trials: readonly QuizTrial[]) => void;
}

export interface EverydayStart {
  durationMs?: number;
  /** Told the check once it has run its time (not when stopped early). */
  onDone?: (check: EverydayCheck, tMs: number) => void;
}

export interface FaceTestState {
  running: boolean;
  /** The latest reading, or null before one (or while no face is in view). */
  reading: LiveReading | null;
  /** No face in the latest frame (the readout says so instead of guessing). */
  noFace: boolean;
  /** The room reads too dark to test in (#348): a status line, the same as the take's. */
  tooDark: boolean;
  /** How many times each gesture fired since the test started (#954), by gesture id. */
  gestureFires: Readonly<Record<string, number>>;
  /** The gesture that fired last, or null. */
  lastGesture: string | null;
  /** The gesture listener cannot hear yet (its noise unit warming): hold still. */
  gesturesWarming: boolean;
  /** Start reading live faces against `live`. */
  start(live: LiveModel): void;
  /** Swap in a re-tuned or corrected model without stopping. */
  retune(live: LiveModel): void;
  stop(): void;
  /** The mean of the last few raw live faces (for a correction), or null with no face. */
  capture(): FeatureVector | null;
  /** The quiz under way or just finished, or null. */
  quiz: QuizView | null;
  /** The everyday check under way or just finished, or null. */
  everyday: EverydayView | null;
  /** Start the quiz (the test starts too if it is not running). Ends an everyday check. */
  startQuiz(live: LiveModel, options?: QuizStart): void;
  /** Start the everyday check (the test starts too). Ends a quiz. */
  startEveryday(live: LiveModel, options?: EverydayStart): void;
  /** Stop a quiz or check under way, or clear a finished one's view. */
  stopCheck(): void;
}


function meanOf(vectors: readonly FeatureVector[]): FeatureVector {
  const sum: Record<string, number> = {};
  const n: Record<string, number> = {};
  for (const v of vectors)
    for (const [k, x] of Object.entries(v)) {
      if (!Number.isFinite(x)) continue;
      sum[k] = (sum[k] ?? 0) + x;
      n[k] = (n[k] ?? 0) + 1;
    }
  return Object.fromEntries(Object.keys(sum).map((k) => [k, sum[k] / n[k]]));
}

export function createFaceTestStore(deps: FaceTestDeps): StoreApi<FaceTestState> {
  let source: FaceSource | null = null;
  let reader: LiveReader | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let frames: LiveFrames | null = null;
  let claimed = false;
  let lastPublish = -Infinity;
  const recent: FeatureVector[] = [];
  let quiz: { run: Quiz; onDone?: QuizStart['onDone']; told: boolean } | null = null;
  let everyday: { run: EverydayCheck; durationMs: number; onDone?: EverydayStart['onDone']; told: boolean } | null = null;
  const listen = deps.listen ?? ((model: GestureModel) => createGestureListener(model));
  /** The gestures' listener, and the model it was made for. */
  let listener: GestureListener | null = null;
  let listenedTo: GestureModel | null = null;
  /** A listener for `live`'s gestures, kept while they are the same (a re-tune, a correction). */
  const listenFor = (live: LiveModel) => {
    const model = live.gestures?.model ?? null;
    if (model === listenedTo) return;
    listenedTo = model;
    listener = model && model.gestures.length > 0 ? listen(model) : null;
  };

  return createStore<FaceTestState>()((set, get) => {
    const light = createLightWatch({ get, set }, { everyMs: FACE_TEST_DEFAULTS.lightMs, frames: () => frames, region: deps.region });
    const tick = () => {
      if (!source || !reader) return;
      const read = source.read();
      light.watch(read?.vector ?? null, deps.now());
      // As the categorizer reads it (#385 E8: a hand categorizer's one hand, side-relative).
      const live = read ? { ...read, vector: reader.live.project(read.vector) } : null;
      const now = deps.now();
      hearGestures(live);
      if (!live || !reader.live.inView(live.vector)) {
        if (!get().noFace) set({ noFace: true, reading: null });
        recent.length = 0;
        feedChecks(null, now);
        return;
      }
      recent.push(live.vector);
      if (recent.length > FACE_TEST_DEFAULTS.captureFrames) recent.shift();
      const reading = reader.push(live.vector);
      feedChecks(reading.categoryId, now, live.vector);
      const prev = get().reading;
      if (get().noFace || !prev || prev.categoryId !== reading.categoryId || prev.rejected !== reading.rejected || now - lastPublish >= deps.publishMs) {
        lastPublish = now;
        set({ reading, noFace: false });
      }
    };
    /** The gestures on this frame (at its own stamp: a frame read twice is heard once). */
    const hearGestures = (live: { vector: FeatureVector; t: number } | null) => {
      if (!listener) return;
      const fired = live ? listener.push(live.vector, live.t) : null;
      const warming = listener.warming();
      if (fired) {
        const now = deps.now();
        quiz?.run.fire(fired.gesture, now, now - (fired.t - fired.startT));
        everyday?.run.fire(fired.gesture, now);
        const fires = get().gestureFires;
        set({ gestureFires: { ...fires, [fired.gesture]: (fires[fired.gesture] ?? 0) + 1 }, lastGesture: fired.gesture, gesturesWarming: warming });
      } else if (warming !== get().gesturesWarming) set({ gesturesWarming: warming });
    };
    /** Feed the checks one settled reading; publish them when what a person sees changed. */
    const feedChecks = (categoryId: string | null, now: number, vector?: FeatureVector) => {
      if (quiz && !quiz.told) {
        const before = quiz.run.step(now);
        // A gesture being made holds an asked gesture's deadline (its fire comes at the end).
        quiz.run.push({ categoryId, moving: listener?.inGesture() ?? false }, now, vector);
        const after = quiz.run.step(now);
        const moved = before.kind !== after.kind || ('index' in before && 'index' in after && before.index !== after.index);
        if (moved || now - lastCheckPublish >= deps.publishMs) {
          lastCheckPublish = now;
          set({ quiz: { step: after, trials: [...quiz.run.trials()] } });
        }
        if (quiz.run.done()) {
          quiz.told = true;
          quiz.onDone?.(quiz.run.trials());
        }
      }
      if (everyday && !everyday.told) {
        everyday.run.push({ categoryId }, now);
        const done = everyday.run.done(now);
        if (done || now - lastCheckPublish >= deps.publishMs) {
          lastCheckPublish = now;
          set({ everyday: { elapsedMs: everyday.run.elapsedMs(now), durationMs: everyday.durationMs, fires: { ...everyday.run.fires() }, done } });
        }
        if (done) {
          everyday.told = true;
          everyday.onDone?.(everyday.run, now);
        }
      }
    };
    let lastCheckPublish = -Infinity;
    const ensureRunning = (live: LiveModel) => {
      if (!get().running) get().start(live);
      else get().retune(live);
    };
    return {
      running: false,
      reading: null,
      noFace: false,
      tooDark: false,
      gestureFires: {},
      lastGesture: null,
      gesturesWarming: false,
      quiz: null,
      everyday: null,

      startQuiz(live, options = {}) {
        ensureRunning(live);
        everyday = null;
        const { order: asked, onDone: _onDone, ...timings } = options;
        void _onDone;
        const targets = checkTargets(live);
        const order = asked ?? quizOrder(targets.map((c) => c.id));
        const run = createQuiz(order, { ...timings, events: targets.filter((c) => c.kind === 'gesture').map((c) => c.id) });
        run.start(deps.now());
        quiz = { run, onDone: options.onDone, told: false };
        lastCheckPublish = -Infinity;
        set({ quiz: { step: run.step(deps.now()), trials: [] }, everyday: null });
      },

      startEveryday(live, options = {}) {
        ensureRunning(live);
        quiz = null;
        const durationMs = options.durationMs ?? EVERYDAY_DEFAULTS.durationMs;
        const run = createEverydayCheck({ durationMs });
        run.start(deps.now());
        everyday = { run, durationMs, onDone: options.onDone, told: false };
        lastCheckPublish = -Infinity;
        set({ everyday: { elapsedMs: 0, durationMs, fires: {}, done: false }, quiz: null });
      },

      stopCheck() {
        quiz = null;
        everyday = null;
        set({ quiz: null, everyday: null });
      },

      start(live) {
        get().stop();
        source = deps.source();
        const video = deps.frames ? source.video() : null;
        frames = video && deps.frames ? deps.frames(video) : null;
        light.reset();
        reader = createLiveReader(live);
        listenFor(live);
        deps.claim(true);
        claimed = true;
        recent.length = 0;
        lastPublish = -Infinity;
        timer = setInterval(tick, deps.pollMs);
        set({ running: true, reading: null, noFace: false, tooDark: false, gestureFires: {}, lastGesture: null, gesturesWarming: false });
      },

      retune(live) {
        if (!get().running) return;
        // A check asks for categories and gestures by id and name: one whose targets changed (a
        // re-cut, a rename, a merge) would ask for ids that can no longer be read, so it ends.
        const key = (m: LiveModel) => checkTargets(m).map((c) => `${c.id}\u0000${c.label}`).join('\u0001');
        if ((quiz || everyday) && reader && key(reader.live) !== key(live)) get().stopCheck();
        reader = createLiveReader(live);
        listenFor(live);
        lastPublish = -Infinity;
      },

      stop() {
        if (timer) clearInterval(timer);
        timer = null;
        if (claimed) deps.claim(false);
        claimed = false;
        frames?.close();
        frames = null;
        source?.dispose();
        source = null;
        reader = null;
        listener = null;
        listenedTo = null;
        recent.length = 0;
        quiz = null;
        everyday = null;
        if (get().running || get().quiz || get().everyday || get().tooDark || get().gesturesWarming) {
          set({ running: false, reading: null, noFace: false, tooDark: false, gesturesWarming: false, quiz: null, everyday: null });
        }
      },

      capture() {
        return recent.length > 0 ? meanOf(recent) : null;
      },
    };
  });
}
