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
 *
 * **Connecting is a second, failable step** on top of loading, and it follows the
 * same rules: a failed connect is an `error` status that is NOT retried every tick
 * (pause/play or disable/enable is the player's "try again"); a connect that
 * settles after the engine was dropped, or after a pause, touches nothing; the
 * steering diff is reset when a connection opens so the current prompts reach a
 * fresh session; and a session the server closed is reported as an error, not as
 * `active`. The `status` output says where the engine is — off, loading, ready,
 * connecting, active, or unavailable with a reason (`no-key`) — so a panel can be
 * honest instead of showing a dead toggle.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { lazyResource, withActive, type LoadStatus } from '@/lazy';
import { getStoredKey } from '@/keys/providerKeys';
import type { GenerativeEngine, GenerativeEngineFactory, GenerativeSteer } from './generative';

/** The provider whose key Lyria uses — the same store the assistant's Google
 *  provider reads, so one pasted key serves both. */
export const LYRIA_KEY_PROVIDER = 'google' as const;

const Params = z.object({
  /** Minimum seconds between pushed steer updates (Lyria likes ~0.2s). */
  throttleSec: z.number().min(0).default(0.2),
});
type Params = z.infer<typeof Params>;

/** Lifecycle/capability status surfaced on the node's `status` port: the shared
 *  lazy-load vocabulary. `unavailable` + `reason: 'no-key'` is the one a panel must
 *  turn into a key prompt; `error` + `reason: 'connect'` is a failed or lost session. */
export type GenerativeStatus = LoadStatus;

/**
 * The default browser factory: lazy-load the Lyria adapter only when the layer is
 * enabled AND its prerequisites exist, so nothing generative is imported until it
 * could actually be used. A missing key or a not-yet-tapped audio graph is a
 * *transient* unavailability (`retry`): the resource asks again after a pause, so
 * pasting the key or tapping to play makes the layer come alive without the player
 * having to switch it off and on (a review catch on #188 PR 4).
 */
const _defaultFactory: GenerativeEngineFactory = async (opts) => {
  if (!getStoredKey(LYRIA_KEY_PROVIDER)) {
    return {
      resource: null,
      reason: 'no-key',
      retry: true,
      message: 'Add a Gemini API key (the assistant\u2019s Google key) to enable the generative layer.',
    };
  }
  if (!opts.audioContext || !opts.destination) {
    return { resource: null, reason: 'no-audio', retry: true, message: 'Tap to play first: the generative layer needs the audio graph.' };
  }
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

const _errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

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
    // The transport's own little state machine, on top of the loaded engine:
    //   started    — the transport is on (play requested)
    //   connecting — a connect() is in flight for the CURRENT start
    //   startGen   — bumped on every start/pause/drop, so a connect() settling for an
    //                older start (or an older engine) is a late arrival: touch nothing
    //   failure    — why the last start failed; cleared by pause or by dropping the
    //                engine, so play is not re-hammered every tick (rule 3)
    let started = false;
    let connecting = false;
    let startGen = 0;
    let failure: string | null = null;
    let lastSentAt = -Infinity;
    let lastPromptsKey = '';
    let lastConfigKey = '';
    let lastBpm: number | undefined;
    let lastVolume: number | undefined;
    let resources: Record<string, unknown> = {};
    let log: ((msg: string) => void) | undefined;

    /** Forget the per-engine steering diff state, so a (re)created or (re)connected
     *  engine gets the current prompts/config pushed again rather than being assumed
     *  up to date. */
    const forgetSteering = () => {
      lastPromptsKey = '';
      lastConfigKey = '';
      lastBpm = undefined;
      lastSentAt = -Infinity;
    };
    /** The engine went away (disabled, or dropped): reset everything per-engine. */
    const forgetEngine = () => {
      started = false;
      connecting = false;
      startGen++;
      failure = null;
      lastVolume = undefined;
      forgetSteering();
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

    const start = (e: GenerativeEngine): void => {
      started = true;
      connecting = true;
      const myGen = ++startGen;
      const current = () => myGen === startGen && engine.current() === e;
      void Promise.resolve(e.connect())
        .then(() => {
          if (!current()) return; // paused, restarted, or the engine was dropped meanwhile
          connecting = false;
          forgetSteering(); // a fresh session knows nothing: re-send the current steer
          return e.play();
        })
        .catch((err) => {
          if (!current()) return;
          connecting = false;
          started = false;
          failure = _errorText(err);
          (log ?? console.warn)(`[lyria] could not start the generative engine: ${failure}`);
        });
    };

    const statusOf = (base: LoadStatus): GenerativeStatus => {
      if (failure) return { ...base, phase: 'error', reason: 'connect', message: failure };
      if (started && connecting) return { ...base, phase: 'loading', message: 'Connecting to Lyria...' };
      return withActive(base, started, 'Playing');
    };

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
          if (started || failure) forgetEngine(); // the engine went away while in use
          return { status: engine.status() };
        }

        // ---- volume (diffed; a mock engine may not implement it) ----
        const volume = typeof inputs.volume === 'number' ? Math.min(1, Math.max(0, inputs.volume)) : 0.7;
        if (volume !== lastVolume) {
          lastVolume = volume;
          e.setVolume?.(volume);
        }

        // ---- a session the server closed is an error, not `active` ----
        if (started && !connecting && e.connected?.() === false) {
          started = false;
          startGen++;
          failure = 'The connection to Lyria closed';
          (log ?? console.warn)(`[lyria] ${failure}`);
        }

        // ---- lifecycle ----
        if (playing && !started && !failure) {
          start(e);
        } else if (!playing && (started || failure)) {
          // Pause. Also the player's "try again" after a failure: the latch clears
          // here, so the NEXT play attempts a fresh connect (rule 4), and a connect
          // still in flight for this start becomes a late arrival (rule 2).
          // Nothing to pause while still connecting: that start is discarded on arrival.
          const wasPlaying = started && !connecting;
          started = false;
          connecting = false;
          failure = null;
          startGen++;
          if (wasPlaying) {
            void Promise.resolve(e.pause()).catch(() => {
              /* best effort */
            });
          }
        }

        // ---- steering (throttled + diffed; only once a session is open) ----
        const steer = inputs.steer as GenerativeSteer | undefined;
        if (started && !connecting && steer && ctx.time - lastSentAt >= p.throttleSec) {
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

        return { status: statusOf(engine.status()) };
      },
      dispose() {
        engine.dispose();
      },
    };
  },
});
