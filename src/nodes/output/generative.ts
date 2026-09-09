/**
 * GenerativeEngine facade — the interface a steerable real-time music generator
 * implements, so the rest of the DAG never depends on a specific vendor. The
 * `lyria` node (Google Lyria RealTime) is the first impl; an in-browser model or
 * a mock implements the same shape (`docs/design/generative-instruments.md`).
 *
 * Also the {@link GenerativeEngineFactory} seam (#188): how the `lyria` node
 * obtains an engine without importing one. The host may inject a factory through
 * `ctx.resources.createGenerativeEngine` (tests, custom hosts); otherwise the node
 * lazily imports the browser-only `lyria_engine.ts`, which is the only static
 * importer of `@google/genai`. The factory resolves a `LoadResult`: the engine, or
 * an actionable reason (`no-key`) it cannot be had.
 *
 * This is a types-only module (no runtime), safe to import anywhere.
 */
import type { LoadResult } from '@/lazy';

/** A weighted text prompt ("strain") steering the generator. */
export interface WeightedPrompt {
  text: string;
  /** 0 = off; typically 0..2. */
  weight: number;
}

/** High-level generation dials. Names mirror Lyria's config knobs. */
export interface GenerativeConfig {
  bpm?: number;
  density?: number; // 0..1
  brightness?: number; // 0..1
  guidance?: number;
  temperature?: number;
}

/** The steering payload produced by the `indirect-map` node each update. */
export interface GenerativeSteer {
  prompts: WeightedPrompt[];
  config: GenerativeConfig;
}

/** Facade implemented by generative output nodes (e.g. `lyria`). */
export interface GenerativeEngine {
  connect(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  setWeightedPrompts(prompts: WeightedPrompt[]): void;
  setConfig(config: GenerativeConfig): void;
  /** Reset the model's musical context (needed when bpm/scale changes). */
  resetContext(): void;
  /** The engine's own output gain 0..1 (the `steer.volume` dial). Optional: a
   *  mock or a MIDI-emitting engine has nothing to attenuate. */
  setVolume?(gain: number): void;
  /** Is the session still open? Optional; a session-shaped engine reports false
   *  after the server closes or errors the socket, so the node can say so instead of
   *  reporting `active` over a dead connection. */
  connected?(): boolean;
}

/** What a {@link GenerativeEngineFactory} receives from the node: the host audio
 *  graph (absent in a headless run) and the abort signal of the request. */
export interface GenerativeEngineOpts {
  audioContext?: AudioContext;
  /** Where the engine mixes its audio (the app's masterGain). */
  destination?: AudioNode;
  signal: AbortSignal;
}

/**
 * Obtains an engine on demand. Injected via `ctx.resources.createGenerativeEngine`,
 * else defaulted to the lazy browser import. Resolves a {@link LoadResult} — it
 * should reject only on a truly unexpected fault; the node reports that as an
 * `error` status rather than letting a tick throw.
 */
export type GenerativeEngineFactory = (opts: GenerativeEngineOpts) => Promise<LoadResult<GenerativeEngine>>;
