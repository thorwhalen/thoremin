/**
 * `lyria` node — the generative-music sink for the *indirect* mapping path.
 * Consumes a {@link GenerativeSteer} (weighted prompts + config dials, produced
 * by `indirect-map`) plus a `playing` transport flag, and drives a
 * {@link GenerativeEngine} (injected via `ctx.resources.generativeEngine`).
 *
 * The vendor websocket/audio lives behind the GenerativeEngine facade (the
 * browser-only `LyriaEngine` is the first impl). This node owns the *contract
 * logic* — lifecycle (connect/play/pause), throttling steer updates to a steady
 * cadence (Lyria likes ~200ms), diffing so we only send real changes, and
 * resetting the model context when tempo changes. That logic is pure enough to
 * unit-test with a mock engine (no network, no audio), using `ctx.time` for a
 * deterministic throttle clock.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import type { GenerativeEngine, GenerativeSteer } from './generative';

const Params = z.object({
  /** Minimum seconds between pushed steer updates (Lyria likes ~0.2s). */
  throttleSec: z.number().min(0).default(0.2),
});
type Params = z.infer<typeof Params>;

export const lyriaNode = defineNode<Params>({
  type: 'lyria',
  title: 'Lyria Generative',
  description: 'Steers a generative engine (Lyria RealTime) from weighted prompts + config dials.',
  inputs: [
    { name: 'steer', kind: 'generative-steer' },
    { name: 'playing', kind: 'boolean', default: false },
  ],
  outputs: [{ name: 'state', kind: 'string' }],
  params: Params,
  make(p) {
    let started = false;
    let lastSentAt = -Infinity;
    let lastPromptsKey = '';
    let lastConfigKey = '';
    let lastBpm: number | undefined;

    return {
      process(inputs, ctx: NodeContext) {
        const engine = ctx.resources.generativeEngine as GenerativeEngine | undefined;
        if (!engine) return { state: 'no-engine' };

        const playing = inputs.playing === true;
        const steer = inputs.steer as GenerativeSteer | undefined;

        // ---- lifecycle ----
        if (playing && !started) {
          started = true;
          // The engine is responsible for connect-once idempotency. Guard play()
          // with the *current* started state: if the transport was paused
          // between connect() resolving and this microtask, don't start playing.
          void Promise.resolve(engine.connect()).then(() => {
            if (started) engine.play();
          });
        } else if (!playing && started) {
          started = false;
          void engine.pause();
        }

        // ---- steering (throttled + diffed) ----
        if (started && steer && ctx.time - lastSentAt >= p.throttleSec) {
          let sent = false;

          const configKey = JSON.stringify(steer.config ?? {});
          if (configKey !== lastConfigKey) {
            const bpm = steer.config?.bpm;
            if (bpm !== undefined && lastBpm !== undefined && bpm !== lastBpm) {
              engine.resetContext(); // tempo change needs a fresh musical context
            }
            engine.setConfig(steer.config ?? {});
            lastConfigKey = configKey;
            lastBpm = bpm;
            sent = true;
          }

          const promptsKey = JSON.stringify(steer.prompts ?? []);
          if (promptsKey !== lastPromptsKey) {
            engine.setWeightedPrompts(steer.prompts ?? []);
            lastPromptsKey = promptsKey;
            sent = true;
          }

          if (sent) lastSentAt = ctx.time;
        }

        return { state: started ? 'playing' : 'stopped' };
      },
      dispose() {
        if (started) {
          started = false;
          // best-effort stop; engine may already be gone
        }
      },
    };
  },
});
