/**
 * GenerativeEngine facade — the interface a steerable real-time music generator
 * implements, so the rest of the DAG never depends on a specific vendor. The
 * `lyria` node (Google Lyria RealTime, ported from wips/) is the first impl; a
 * self-hosted Magenta-RT2 service or a mock could implement the same shape.
 *
 * This is a types-only module (no runtime), safe to import anywhere.
 */

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
}
