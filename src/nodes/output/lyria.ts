/**
 * `lyria` node — the generative-music sink for the *indirect* mapping path.
 * Consumes a {@link GenerativeSteer} (weighted prompts + config dials, produced
 * by `indirect-map`) plus `enabled` / `playing` / `volume` controls, and drives a
 * {@link GenerativeEngine} it obtains on demand through the lazy-loading pattern
 * (#188, `docs/design/lazy-loading.md`).
 *
 * The vendor websocket/audio lives behind the GenerativeEngine facade (the
 * browser-only `LyriaEngine` is the first impl). This node owns the *contract
 * logic* — lifecycle (connect/play/pause), throttling steer updates to a steady
 * cadence (Lyria likes ~200ms), diffing so we only send real changes, and
 * resetting the model context when tempo changes. That logic is pure enough to
 * unit-test with a mock engine (no network, no audio), using `ctx.time` for a
 * deterministic throttle clock.
 *
 * **Nothing loads until `enabled` is true.** The engine comes from a
 * {@link GenerativeEngineFactory} — injected by the host as
 * `ctx.resources.createGenerativeEngine` (tests, custom hosts), or the default
 * here, which dynamically imports `./lyria_engine` the first time the layer is
 * switched on, so `@google/genai` is never in the main bundle and never fetched
 * by a player who does not use it. A host may also hand over a ready-made engine
 * as `ctx.resources.generativeEngine` (the pre-#188 contract; still honoured).
 * The `status` output says where the engine is — off, loading, ready, active, or
 * unavailable with a reason (`no-key`) — so a panel can be honest instead of
 * showing a dead toggle.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { lazyResource, withActive, type LoadStatus } from '@/lazy';
import type { GenerativeEngine, GenerativeEngineFactory, GenerativeSteer } from './generative';

const Params = z.object({
  /** Minimum seconds between pushed steer updates (Lyria likes ~0.2s). */
  throttleSec: z.number().min(0).default(0.2),
});
type Params = z.infer<typeof Params>;

/** Lifecycle/capability status surfaced on the node's `status` port: the shared
 *  lazy-load vocabulary. `unavailable` + `reason: 'no-key'` is the one a panel must
 *  turn into a key prompt. */
export type GenerativeStatus = LoadStatus;

/** The default browser factory: lazy-load the Lyria adapter only when the layer is
 *  enabled, so nothing generative is imported until asked for. */
const _defaultFactory: GenerativeEngineFactory = async (opts) => {
  const { createLyriaEngine } = await import('./lyria_engine');
  return createLyriaEngine(opts);
};

/** Resolve the factory for this tick: an injected factory wins; a pre-built engine
 *  on `resources.generativeEngine` is wrapped as an already-loaded result; otherwise
 *  the lazy browser default. */
function _factoryFor(resources: Record<string, unknown>): GenerativeEngineFactory {
  const injected = resources.createGenerativeEngine as GenerativeEngineFactory | undefined;
  if (injected) return injected;
  const prebuilt = resources.generativeEngine as GenerativeEngine | undefined;
  if (prebuilt) return async () => ({ resource: prebuilt, message: 'Generative engine ready' });
  return _defaultFactory;
}

export const lyriaNode = defineNode<Params>({
  type: 'lyria',
  roles: ['synth', 'generate'],
  title: 'Lyria Generative',
  description:
    'Steers a generative engine (Lyria RealTime) from weighted prompts + config dials. ' +
    'Off by default; loads its SDK only when enabled, and needs a Gemini API key.',
  inputs: [
    { name: 'steer', kind: 'generative-steer' },
    { name: 'enabled', kind: 'boolean', default: false, description: 'The layer exists: load the engine and hold a session.' },
    { name: 'playing', kind: 'boolean', default: false, description: 'The transport: stream audio while true.' },
    { name: 'volume', kind: 'number', default: 0.7, description: 'The generative bus gain 0..1.' },
  ],
  outputs: [{ name: 'status', kind: 'load-status' }],
  params: Params,
  make(p) {
    let started = false;
    let connecting = false;
    let lastSentAt = -Infinity;
    let lastPromptsKey = '';
    let lastConfigKey = '';
    let lastBpm: number | undefined;
    let lastVolume: number | undefined;
    let resources: Record<string, unknown> = {};
    let log: ((msg: string) => void) | undefined;

    /** Forget the per-engine steering diff state, so a re-created engine gets the
     *  current prompts/config pushed again rather than being assumed up to date. */
    const forgetEngine = () => {
      started = false;
      connecting = false;
      lastPromptsKey = '';
      lastConfigKey = '';
      lastBpm = undefined;
      lastVolume = undefined;
    };

    const engine = lazyResource<GenerativeEngine>({
      label: 'generative engine',
      load: ({ signal }) =>
        _factoryFor(resources)({
          audioContext: resources.audioContext as AudioContext | undefined,
          destination: resources.masterGain as AudioNode | undefined,
          signal,
        }),
      unload: (e) => {
        forgetEngine();
        void Promise.resolve(e.stop()).catch(() => {
          /* best effort; the engine may already be gone */
        });
      },
      log: (m) => (log ?? console.warn)(m),
    });

    return {
      process(inputs, ctx: NodeContext) {
        resources = ctx.resources;
        log = ctx.log;
        const enabled = inputs.enabled === true;
        const playing = enabled && inputs.playing === true;

        // ---- obtain / drop the engine (never awaited; the resource reports phase) ----
        engine.want(enabled);
        const e = engine.current();
        if (!e) {
          if (started) forgetEngine(); // the engine went away (disabled) while playing
          return { status: engine.status() };
        }

        // ---- volume (diffed; a mock engine may not implement it) ----
        const volume = typeof inputs.volume === 'number' ? Math.min(1, Math.max(0, inputs.volume)) : 0.7;
        if (volume !== lastVolume) {
          lastVolume = volume;
          e.setVolume?.(volume);
        }

        // ---- lifecycle ----
        if (playing && !started) {
          started = true;
          connecting = true;
          // The engine is responsible for connect-once idempotency. Guard play()
          // with the *current* started state: if the transport was paused
          // between connect() resolving and this microtask, don't start playing.
          void Promise.resolve(e.connect())
            .then(() => {
              connecting = false;
              if (started && engine.current() === e) return e.play();
            })
            .catch((err) => {
              connecting = false;
              started = false;
              (log ?? console.warn)(`[lyria] could not start the generative engine: ${String(err)}`);
            });
        } else if (!playing && started) {
          started = false;
          connecting = false;
          void Promise.resolve(e.pause()).catch(() => {
            /* best effort */
          });
        }

        // ---- steering (throttled + diffed) ----
        const steer = inputs.steer as GenerativeSteer | undefined;
        if (started && steer && ctx.time - lastSentAt >= p.throttleSec) {
          let sent = false;

          const configKey = JSON.stringify(steer.config ?? {});
          if (configKey !== lastConfigKey) {
            const bpm = steer.config?.bpm;
            if (bpm !== undefined && lastBpm !== undefined && bpm !== lastBpm) {
              e.resetContext(); // tempo change needs a fresh musical context
            }
            e.setConfig(steer.config ?? {});
            lastConfigKey = configKey;
            lastBpm = bpm;
            sent = true;
          }

          const promptsKey = JSON.stringify(steer.prompts ?? []);
          if (promptsKey !== lastPromptsKey) {
            e.setWeightedPrompts(steer.prompts ?? []);
            lastPromptsKey = promptsKey;
            sent = true;
          }

          if (sent) lastSentAt = ctx.time;
        }

        const base = engine.status();
        const status: GenerativeStatus =
          started && connecting ? { ...base, phase: 'loading', message: 'Connecting to Lyria...' } : withActive(base, started, 'Playing');
        return { status };
      },
      dispose() {
        engine.dispose();
      },
    };
  },
});
