/**
 * What the audio thread tells the rest of the app (the audio-input seam, #866;
 * `docs/design/audio-input.md`).
 *
 * Plain types with no runtime imports, on purpose: this module is bundled into the
 * AudioWorklet, where every byte is code the audio thread loads, and where Zod has nothing
 * to validate (the worklet produces these). The Zod schemas a DAG port checks them with are
 * in `./events.ts`, on the main-thread side.
 *
 * Every time here is on the AUDIO clock: `frame` is the context's sample frame at which the
 * thing happened in the microphone signal (`currentFrame` of the render quantum plus the
 * offset inside it). Converting to engine time is the host's job (`./clock.ts`), because
 * only the host knows the input stage and the engine-to-context map at the moment the event
 * is drained.
 */

/** A sharp rise of the input: something was struck. */
export interface OnsetEvent {
  kind: 'onset';
  /** The first sample of the attack, as the detector placed it. */
  frame: number;
  /** The sample at which the detector knew (the end of the hop that crossed). */
  detectedFrame: number;
  /** How far above the noise floor the attack rose, as a ratio of energies (>= the threshold ratio). */
  strength: number;
}

/** A struck sound recognised as one of the player's taught classes. */
export interface ClassEvent {
  kind: 'class';
  /** The onset this decision is about. */
  frame: number;
  /** The sample at which the decision was made (the onset plus the analysis window). */
  decidedFrame: number;
  /** The class label, or null when the sound was nothing taught (rejected). */
  label: string | null;
  /** 0..1: how much nearer the nearest class was than the next other class. */
  confidence: number;
  /** Distance to the nearest example, in the model's within-class units. */
  distance: number;
  /** Peak amplitude of the attack window, 0..1 (the hit's velocity before any curve). */
  peak: number;
  /** The sample the decision triggered, or null when none was mapped (or it was rejected). */
  sample: string | null;
  /**
   * `fast`: the first decision, on the short window, which already sounded. `final`: the
   * re-decision on the long window ("sound early, decide late"), sent only when refinement is on.
   */
  stage: 'fast' | 'final';
  /** On a final decision: it changed the fast one's class (and the sample was swapped). */
  revised: boolean;
}

/**
 * The raw audio around one onset, captured for teaching (`../audio/examples.ts`): the samples
 * from `pre` before the onset to `post` after it. Only sent while capture is on.
 */
export interface SnippetEvent {
  kind: 'snippet';
  frame: number;
  /** Index of the onset inside `pcm`. */
  onset: number;
  sampleRate: number;
  pcm: Float32Array;
}

/** The input's level over one reporting period. */
export interface LevelEvent {
  kind: 'level';
  frame: number;
  /** RMS of the input over the period, 0..1. */
  rms: number;
  /** Peak absolute sample over the period, 0..1. */
  peak: number;
}

/** A pitch estimate (reserved for a pitch analyser; lane A of #866). */
export interface PitchEvent {
  kind: 'pitch';
  frame: number;
  /** Fundamental frequency, Hz, or null when unvoiced. */
  f0: number | null;
  /** 0..1, how periodic the frame was. */
  clarity: number;
}

export type AudioEvent = OnsetEvent | ClassEvent | LevelEvent | PitchEvent | SnippetEvent;
export type AudioEventKind = AudioEvent['kind'];

/**
 * One analyser running on the audio thread: it reads every input quantum, may ADD to the
 * output (a triggered sample, an effect), and returns what it noticed. The processor runs
 * its analysers in order on the same input; each adds into the shared output.
 */
export interface AudioAnalyser {
  /**
   * One render quantum. `input` is the microphone's samples, `output` is ADDED to (never
   * overwritten), `frame` is the context frame of `input[0]`. Must not allocate per call:
   * this runs every 2.7 ms on the audio thread.
   */
  process(input: Float32Array, output: Float32Array, frame: number): readonly AudioEvent[];
  /** A message from the host (a new model, a sample, a parameter). Unknown types are ignored. */
  configure?(message: AnalyserMessage): void;
}

/** A host-to-analyser message: a `type` and whatever that type carries. */
export interface AnalyserMessage {
  type: string;
  [key: string]: unknown;
}
