/**
 * One face session's take, as a pure state machine over (vector, time) pairs (#330 P2): a few
 * seconds of the player's resting face, then the faces they choose, then a built session ready
 * to carve. No timers, no camera, no React: the panel polls the live vector and pushes it here,
 * and a test pushes a recorded fixture through the same calls.
 *
 * The rest comes FIRST, for two reasons the trainer already relies on: it seeds the noise
 * estimate every later distance is measured in (the session's noise warm-up), and it is what
 * "neutral" means, by demonstration, when the categorizer treats neutral as "none of these"
 * (`createCarver`'s `reject` mode). The same take serves both modes: the player relaxes between
 * expressions anyway, and the switch only changes how the pool is carved.
 *
 * Times are engine-clock milliseconds (the live tap's `t`).
 *
 * #385 E3: each hold keeps a few SUPPORTING frames (`support(i)`): the frames from when the
 * hold began to when it was taken (its dwell window), thinned evenly, the modality's keys only.
 * The carve still clusters one point per hold (no dwell-time bias); the frames are evidence a
 * category's spread can later be measured from. The store takes the hold's still the moment
 * the point count grows.
 *
 * #385 E2 adds two phases around the capture. **Explore** comes before the rest: the camera is
 * read (every frame feeds the session's noise estimate) and a watching sampler says when a pose
 * is held, but nothing is collected. **Paused** interrupts the capture: the vocabulary cue ends,
 * and resuming begins a NEW cue segment (`faces-yours`, then `faces-yours#2`, ...). The session
 * pools every vocabulary cue, so the carve is unchanged; and each segment has its own sampler,
 * so no still-point is taken inside a pause and none spans one (a hold in progress when Pause is
 * pressed is dropped with its sampler); a resumed segment is told the last face taken, so holding
 * that face through the pause does not take it twice. A take with no pause has exactly the cues
 * it had before, and a take that explored first resets the noise estimate at the rest, so its
 * units are those of a take that did not.
 *
 * #385 E7 adds **bursts** (Teachable Machine's hold-to-record): while a key or button is held,
 * every frame of the face is collected, and on release the burst becomes ONE hold (its mean, the
 * frames thinned as its support), in a cue segment of its own, so it never mixes with a sampler's
 * hold. A burst may carry a name typed beforehand: a labelled hold, which the carve pins to the
 * category of that name. A burst runs from `faces` (the hold in progress is dropped, and the
 * capture resumes in a new segment after it, the burst's face not taken again) or from `paused`
 * (the take stays paused: burst-only capture). A burst shorter than `minBurstFrames` frames of the
 * modality takes nothing.
 */
import { CueSchema, type Cue, type CueSpecInput } from '@thoremin/sdk/enroll/cue';
import { samplingFor } from '@thoremin/sdk/enroll/cue';
import { createStillPointSampler, type StillPointSampler } from '@thoremin/sdk/enroll/sampler';
import { createSession, type Session } from '@thoremin/sdk/enroll/session';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { keepOnly, sessionSpace, type CarveModality, type NuisanceCueSpec } from '@thoremin/sdk/enroll/modality';
import { faceModality } from '@thoremin/sdk/features/modalities/face';

/** The rest: the baseline and the noise warm-up. */
export function restCue(modality: CarveModality): Cue {
  const { slug, part } = modality.words;
  return CueSchema.parse({
    id: `${slug}-rest`,
    name: 'Rest',
    instruction: modality.words.rest ?? `Look at the camera and relax your ${part}.`,
    rationale: `Sets what "nothing" looks like, and how much your ${part} wanders when you are not asking for anything.`,
    collects: modality.collects(),
    produces: 'baseline',
    sufficiency: { kind: 'frames', minFrames: 60 },
    tags: [modality.id, 'setup'],
  } satisfies CueSpecInput & { id: string; name: string });
}

/** A nuisance demonstration (#382): every frame, whatever moves is down-weighted. */
export function nuisanceCue(modality: CarveModality, spec: NuisanceCueSpec): Cue {
  return CueSchema.parse({
    id: `${modality.words.slug}-${spec.key}`,
    name: spec.name,
    instruction: spec.instruction,
    rationale: spec.rationale,
    collects: { ...modality.collects(), axes: [...spec.axes] },
    produces: 'nuisance',
    sufficiency: { kind: 'frames', minFrames: 1 },
    tags: [modality.id, 'setup'],
  } satisfies CueSpecInput & { id: string; name: string });
}

/** The setup before the capture, in order: the rest, then the modality's nuisances (#382). */
export function setupCues(modality: CarveModality): Cue[] {
  return [restCue(modality), ...(modality.nuisanceCues ?? []).map((spec) => nuisanceCue(modality, spec))];
}

/** The player's own categories in the making: the pool the categories are carved from. */
export function vocabularyCue(modality: CarveModality): Cue {
  const { slug, one, many, category } = modality.words;
  return CueSchema.parse({
    id: `${slug}-yours`,
    name: `Your ${many}`,
    instruction: `Make each ${one} you want the instrument to know. Hold each one for a moment, and relax in between.`,
    rationale: 'These become your categories. You choose how many afterwards, so do not count as you go.',
    collects: modality.collects(),
    produces: 'vocabulary',
    sufficiency: { kind: 'variety', minPoints: 6 },
    tags: [modality.id, category],
  } satisfies CueSpecInput & { id: string; name: string });
}

/** Capture segment `n` (1-based) of the vocabulary cue: the cue itself for the first, a fresh
 *  id after each pause, so beginning it never discards an earlier segment's holds. */
export function segmentCue(modality: CarveModality, n: number): Cue {
  const cue = vocabularyCue(modality);
  return n <= 1 ? cue : { ...cue, id: `${cue.id}#${n}` };
}

/** The resting face: the baseline and the noise warm-up. */
export const FACE_REST_CUE: Cue = restCue(faceModality);

/** The player's own faces: the pool the categories are carved from. */
export const FACE_VOCABULARY_CUE: Cue = vocabularyCue(faceModality);

export const FACE_TAKE_DEFAULTS = {
  /** How long the rest lasts, at least. */
  restMs: 3000,
  /** Rest frames with a face in them needed before the faces begin (the session's noise
   *  warm-up is 30 frames; twice that leaves the estimate settled). */
  minRestFrames: 60,
  /** Supporting frames kept per hold (#385 E3), thinned evenly from its dwell window. */
  supportFrames: 4,
  /** How far back the take remembers frames for a hold's support (the dwell is 220 ms). */
  supportWindowMs: 1000,
  /** Frames of the modality a burst needs to be a hold (#385 E7; about 0.17 s at 30 fps). */
  minBurstFrames: 5,
} as const;

export type FaceTakePhase = 'idle' | 'explore' | 'rest' | 'faces' | 'paused' | 'done';

/** What a hold indicator shows: `open` (moving, or nothing to judge), `settling` (a pose is
 *  being held and will be taken once the dwell is up), `taken` (it was just taken, or while
 *  exploring or paused, would have been), `latched` (the pose held is one already given, or
 *  was held when the capture began: move to a new one first). */
export type HoldState = 'open' | 'settling' | 'taken' | 'latched';

export interface FaceTakeOptions {
  restMs?: number;
  minRestFrames?: number;
  /** The session to feed (a fresh `createSession()` over the modality's space by default; a
   *  test injects options). Vectors pushed are the modality's PROJECTED ones (`projectVector`). */
  session?: Session;
  /** What is carved (the face by default): its cues, and whether a frame shows it. */
  modality?: CarveModality;
  /** Supporting frames kept per hold (0 keeps none). */
  supportFrames?: number;
  /** Frames a burst needs to be a hold. */
  minBurstFrames?: number;
  /** Run the modality's nuisance demonstrations after the rest (#382). Default true; a replay of
   *  a recording that never demonstrated them turns them off. */
  nuisance?: boolean;
}

export interface FaceTake {
  phase(): FaceTakePhase;
  /** Read the camera without collecting anything (from idle). */
  explore(tMs: number): void;
  /** Begin the rest at `tMs` (from idle or explore). */
  start(tMs: number): void;
  /** Stop collecting faces (from `faces`); the reading goes on. */
  pause(tMs: number): void;
  /** Collect faces again, in a new cue segment (from `paused`). */
  resume(tMs: number): void;
  /** The setup step under way (#382): 0 the rest, then each nuisance in turn (`setupCues`). */
  setupStep(): number;
  /** End the setup step under way (a nuisance, never the rest, which sets the units), on to the
   *  next or to the capture. */
  skipSetup(tMs: number): void;
  /** Capture segments begun so far (0 before the faces). */
  segments(): number;
  /** The hold indicator's state now: the capture's sampler while collecting, a watching
   *  sampler while exploring or paused (what WOULD be taken), `open` otherwise. */
  hold(): HoldState;
  /** Feed one live vector. Ignored while idle or done; a repeat of the last time is dropped.
   *  Exploring or paused, it feeds the noise estimate and the watching sampler only. */
  push(vector: FeatureVector, tMs: number): void;
  /** End the take. Builds the session when there is anything to carve; returns whether it built. */
  stop(): boolean;
  /** The rest frames that had the modality in view (a face) (what "neutral" is, by demonstration). */
  restVectors(): readonly FeatureVector[];
  /** Still-points captured so far (each one a held face). */
  pointCount(): number;
  /** Hold `index`'s supporting frames (the modality's keys only): frames from its dwell
   *  window, from when the hold began to when it was taken, thinned evenly. */
  support(index: number): readonly FeatureVector[];
  /** When the faces began (engine ms), or null before. */
  facesStartedAt(): number | null;
  /** Begin a burst (#385 E7) from `faces` or `paused`, named `label` when given. Returns whether
   *  one began. */
  beginBurst(tMs: number, label?: string): boolean;
  /** End the burst: one hold of its frames when there were enough. Returns whether it took one. */
  endBurst(tMs: number): boolean;
  /** The burst under way: its name ('' for none) and frames so far; null when none. */
  burst(): { label: string; frames: number } | null;
  /** The names given to holds (by index), for the labelled ones only. */
  labels(): ReadonlyMap<number, string>;
  session(): Session;
}

export function createFaceTake(options: FaceTakeOptions = {}): FaceTake {
  const restMs = options.restMs ?? FACE_TAKE_DEFAULTS.restMs;
  const minRestFrames = options.minRestFrames ?? FACE_TAKE_DEFAULTS.minRestFrames;
  const minBurstFrames = Math.max(1, Math.floor(options.minBurstFrames ?? FACE_TAKE_DEFAULTS.minBurstFrames));
  /** The burst under way: where it came from, its name, its frames (the modality in view). */
  let bursting: { label: string; t: number; frames: FeatureVector[] } | null = null;
  const labels = new Map<number, string>();
  const modality = options.modality ?? faceModality;
  // A modality with its own keys (a side-relative hand) resolves its cues against its own space.
  const session = options.session ?? createSession(sessionSpace(modality));
  const cues = { rest: restCue(modality), vocabulary: vocabularyCue(modality) };
  const nuisances = options.nuisance === false ? [] : (modality.nuisanceCues ?? []).map((spec) => ({ cue: nuisanceCue(modality, spec), ms: spec.ms }));
  /** The setup step (0 the rest) and when it began. */
  let step = 0;
  let stepAt = 0;
  const supportFrames = Math.max(0, Math.floor(options.supportFrames ?? FACE_TAKE_DEFAULTS.supportFrames));
  /** Recent frames (while capturing), trimmed to the support window. */
  const recent: { vector: FeatureVector; t: number }[] = [];
  const supports: FeatureVector[][] = [];
  let phase: FaceTakePhase = 'idle';
  let t0 = 0;
  let lastT = Number.NEGATIVE_INFINITY;
  let facesAt: number | null = null;
  let segment = 0;
  const rest: FeatureVector[] = [];
  /** Exploring or paused: what WOULD be held, judged as the capture judges it (the vocabulary
   *  cue's features, the session's shared noise), never collected. */
  let watch: StillPointSampler | null = null;
  const watching = (armed: boolean): StillPointSampler | null =>
    samplingFor(cues.vocabulary) === 'still-points'
      ? createStillPointSampler({ armed, cue: cues.vocabulary.id, features: session.featuresFor(cues.vocabulary), noise: session.noise() })
      : null;
  /** Whether the latch now is a point just taken (by the capture, or the watch), not a pose
   *  that was held when the sampler began. Cleared by the next move (the sampler re-arms). */
  let justTaken = false;
  const holdOf = (settling: boolean, armed: boolean): HoldState => {
    if (armed) justTaken = false;
    return !armed ? (justTaken ? 'taken' : 'latched') : settling ? 'settling' : 'open';
  };

  const endBurst = (): boolean => {
    const b = bursting;
    if (!b) return false;
    bursting = null;
    const took = b.frames.length >= minBurstFrames;
    const mean = took ? meanOf(b.frames) : null;
    if (mean) {
      const index = session.points().length;
      segment++;
      session.beginCue(segmentCue(modality, segment), { after: mean });
      session.addPoint({ vector: mean, t: b.t, cue: '' });
      supports[index] = thin(b.frames.map((f) => keepOnly(modality, f)), supportFrames);
      if (b.label) labels.set(index, b.label);
      justTaken = true;
      if (phase === 'paused') session.endCue();
    } else if (phase === 'faces') {
      segment++;
      const last = session.points().at(-1);
      session.beginCue(segmentCue(modality, segment), last ? { after: last.vector } : {});
    }
    // Back where it is (a burst never outlives a pause or a resume, which end it first):
    // capturing goes on in a new segment; paused stays paused, watching.
    if (phase === 'paused') watch = watching(false);
    return took;
  };

  /** The next setup step after the one under way (a nuisance, or the capture). */
  const nextStep = (tMs: number) => {
    session.endCue();
    step += 1;
    stepAt = tMs;
    if (step <= nuisances.length) {
      session.beginCue(nuisances[step - 1].cue);
      return;
    }
    segment = 1;
    session.beginCue(segmentCue(modality, segment));
    phase = 'faces';
    justTaken = false;
    facesAt = tMs;
  };

  return {
    phase: () => phase,
    setupStep: () => (phase === 'rest' ? step : 0),
    skipSetup(tMs) {
      if (phase === 'rest' && step > 0) nextStep(tMs);
    },
    explore() {
      if (phase !== 'idle') return;
      phase = 'explore';
      watch = watching(true);
    },
    start(tMs) {
      if (phase !== 'idle' && phase !== 'explore') return;
      // Exploring is making faces: its frame-to-frame differences would warm the noise estimate
      // on motion and set the units the take is carved in. The capture's units start at the rest.
      if (phase === 'explore') session.noise().reset();
      phase = 'rest';
      watch = null;
      justTaken = false;
      t0 = tMs;
      step = 0;
      stepAt = tMs;
      session.beginCue(cues.rest);
    },
    pause() {
      if (bursting) endBurst();
      if (phase !== 'faces') return;
      session.endCue();
      phase = 'paused';
      // The pose held as Pause is pressed reads as latched until the player moves.
      watch = watching(false);
      justTaken = false;
    },
    resume() {
      if (bursting) endBurst();
      if (phase !== 'paused') return;
      watch = null;
      segment++;
      // The new segment continues the capture: the last face taken is not taken again.
      const last = session.points().at(-1);
      session.beginCue(segmentCue(modality, segment), last ? { after: last.vector } : {});
      phase = 'faces';
      justTaken = false;
    },
    segments: () => segment,
    hold() {
      if (bursting) return 'settling';
      if (phase === 'faces') return holdOf(session.settling(), session.armed());
      if ((phase === 'explore' || phase === 'paused') && watch) return holdOf(watch.isSettling(), watch.isArmed());
      return 'open';
    },
    push(vector, tMs) {
      if (phase === 'idle' || phase === 'done') return;
      if (!(tMs > lastT)) return;
      lastT = tMs;
      const before = session.points().length;
      session.push(vector, tMs);
      if (bursting) {
        // No cue is active during a burst: the session only measures noise; the take collects.
        if (modality.read(vector) !== null) bursting.frames.push(vector);
        return;
      }
      if (phase === 'explore' || phase === 'paused') {
        if (modality.read(vector) !== null && watch?.push(vector, tMs)) justTaken = true;
        return;
      }
      if (supportFrames > 0) {
        recent.push({ vector, t: tMs });
        while (recent.length > 0 && tMs - recent[0].t > FACE_TAKE_DEFAULTS.supportWindowMs) recent.shift();
      }
      const points = session.points();
      for (let i = before; i < points.length; i++) supports[i] = thin(recent.filter((f) => f.t >= points[i].t && modality.read(f.vector) !== null).map((f) => keepOnly(modality, f.vector)), supportFrames);
      if (points.length > before) justTaken = true;
      if (phase === 'rest') {
        if (step === 0) {
          if (modality.read(vector) !== null) rest.push(vector);
          if (tMs - t0 >= restMs && rest.length >= minRestFrames) nextStep(tMs);
        } else if (tMs - stepAt >= nuisances[step - 1].ms) nextStep(tMs);
      }
    },
    stop() {
      if (phase === 'idle' || phase === 'done') return session.built();
      if (bursting) endBurst();
      watch = null;
      if (phase === 'explore') {
        // Nothing was collected: an exploration ends with nothing to carve.
        phase = 'done';
        return false;
      }
      if (session.activeCue()) session.endCue();
      phase = 'done';
      if (!session.ready()) return false;
      session.build();
      return true;
    },
    restVectors: () => rest,
    pointCount: () => session.points().length,
    support: (index) => supports[index] ?? [],
    facesStartedAt: () => facesAt,
    beginBurst(tMs, label = '') {
      if (bursting || (phase !== 'faces' && phase !== 'paused')) return false;
      // The capture's hold in progress is dropped with its segment (as a pause drops it).
      if (phase === 'faces') session.endCue();
      watch = null;
      justTaken = false;
      bursting = { label: label.trim(), t: tMs, frames: [] };
      return true;
    },
    endBurst: () => endBurst(),
    burst: () => (bursting ? { label: bursting.label, frames: bursting.frames.length } : null),
    labels: () => labels,
    session: () => session,
  };
}

/** The mean of `vectors` over the union of their finite keys. */
function meanOf(vectors: readonly FeatureVector[]): FeatureVector {
  const sum: Record<string, number> = {};
  const n: Record<string, number> = {};
  for (const v of vectors)
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (!Number.isFinite(x)) continue;
      sum[k] = (sum[k] ?? 0) + x;
      n[k] = (n[k] ?? 0) + 1;
    }
  const out: FeatureVector = {};
  for (const k of Object.keys(sum)) out[k] = sum[k] / n[k];
  return out;
}

/** At most `n` of `frames`, evenly spaced, first and last kept. */
function thin<T>(frames: readonly T[], n: number): T[] {
  if (frames.length <= n) return [...frames];
  if (n <= 1) return n === 1 ? [frames[frames.length - 1]] : [];
  return Array.from({ length: n }, (_, i) => frames[Math.round((i * (frames.length - 1)) / (n - 1))]);
}
