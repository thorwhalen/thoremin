/**
 * The `audio-events` node's CONTRACT (the `<node>.schema.ts` pattern): its params, the event
 * shape on its port, and the slice of the audio-input hub it reads from `ctx.resources`, so a
 * consumer (a game, an overlay element, a test) imports this and never the node.
 *
 * Each event on the port is an analyser's event (`@thoremin/sdk/audio/types`) plus `source` (the
 * analyser's id as the consumer named it) and `t`: the ENGINE time at which the sound reached the
 * microphone (the stamp moved back by the input stage), comparable with every other engine time.
 * `frame` stays the context frame it was stamped at.
 */
import { z } from 'zod';
import type { AudioEvent } from '@thoremin/sdk/audio/types';
import type { InputStage } from '@thoremin/sdk/timing/input_stage';

export const AUDIO_EVENTS_NODE = 'audio-events';

export const AnalyserSpecSchema = z.object({
  name: z.string().min(1),
  id: z.string().min(1).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const AudioEventsParamsSchema = z.object({
  /** The analysers this node's lease runs (default: every onset and the level). */
  analysers: z.array(AnalyserSpecSchema).default([{ name: 'onset' }]),
  /** Where the sound comes from (the URL's `?audio.source=` overrides). */
  source: z.enum(['microphone', 'replay', 'synthetic']).default('microphone'),
  /** Microphone processing this consumer asks for (all off by default). */
  echoCancellation: z.boolean().default(false),
  noiseSuppression: z.boolean().default(false),
  autoGainControl: z.boolean().default(false),
});
export type AudioEventsParams = z.infer<typeof AudioEventsParamsSchema>;

/** One event on the `events` port. */
export type TimedAudioEvent = AudioEvent & { source: string; t: number };

/** The slice of the hub the node reads (`resources.audioInput`); a test passes a fake. */
export interface AudioInputLike {
  acquire(req: { analysers: readonly z.infer<typeof AnalyserSpecSchema>[]; constraints?: Record<string, boolean>; source?: AudioEventsParams['source'] }): {
    drain(): { source: string; event: AudioEvent }[];
    release(): void;
  };
  status(): { state: string; sampleRate: number | null };
  inputStage(): InputStage;
  contextTime(): number | null;
}

/**
 * Engine time of a sound stamped at context `frame`: the tick's engine time, minus how long ago
 * on the context clock it was stamped, minus the input stage (it reached the microphone that much
 * earlier). Pure, for the node and its tests.
 */
export function stampToEngineTime(frame: number, at: { sampleRate: number; contextNow: number; engineNow: number; inputStage: number }): number {
  return at.engineNow - (at.contextNow - frame / at.sampleRate) - at.inputStage;
}
