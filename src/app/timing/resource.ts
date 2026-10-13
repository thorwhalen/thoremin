/**
 * The app's timing resource (step 0 of the 2026-10-05 timing plan) — the one instance
 * the engine serves, and its one owner.
 *
 * `useEngine` creates it beside the other host resources, installs its reader as
 * `ctx.resources.timing` (a function read synchronously per tick, like `controls` and
 * `featureDemand`) and attaches its tracker to the live engine as a tap, always, not only
 * under `?probe=latency`: the lead budget is what the air drum decides against on every
 * stroke, so it cannot live in a verification affordance. The pure estimates are
 * `@thoremin/sdk/timing/tracker`; this module is the browser glue around them:
 *
 * - the audio epoch's triggers: the context's `statechange` (WebKit also has a
 *   non-standard `interrupted` state, used on iOS for calls and Siri), the device list's
 *   `devicechange` (an AirPods connect turns 16 ms of output latency into 150), and a
 *   sample-rate mismatch (checked by the tracker each tick). The context is created
 *   lazily on the first tap, so the listeners bind when it first appears;
 * - the granted camera settings (`track.getSettings()`, device ids removed), reported
 *   once the stream is live; the DELIVERED rate is measured by the tracker;
 * - the page's timer (#318): `crossOriginIsolated` and the resolution of
 *   `performance.now()`, measured once at creation (1 ms on Firefox and Safari without
 *   isolation, 100 us or finer on Chromium): no stamp is more precise than the clock
 *   that made it.
 *
 * Nothing here is a shell feature; the readout is the camera status line
 * (`TimingChip.tsx`), fed through `timingStatus.ts` by a change-gated sink.
 */
import type { Tap } from '@thoremin/dag';
import { TimingTracker, type CameraSettings, type RuntimeChecks, type TimingReading } from '@thoremin/sdk/timing/tracker';
import type { OutputStageAudioLike } from '@thoremin/sdk/timing/output_stage';

export interface TimingResource {
  /** Attach to the live engine (`engine.addTap`). */
  readonly tap: Tap;
  /** The per-tick read the nodes perform; install under `resources.timing`. */
  reading(): TimingReading;
  /** The camera stream the instrument runs on (null for a clip or no camera). */
  noteCamera(stream: MediaStream | null): void;
  /** Release the listeners. */
  dispose(): void;
}

export interface TimingResourceOptions {
  /** Reads the host's audio context, if any (created lazily on the first tap). */
  audio: () => (AudioContext & OutputStageAudioLike) | undefined;
  now?: () => number;
  /** The tap key of the hands source output. */
  sourceKey?: string;
  /** The page's timer checks (default: measured now, {@link runtimeChecks}). */
  runtime?: RuntimeChecks;
}

/** How long the timer probe may spin, ms. */
export const TIMER_PROBE_MS = 3;
/** The most readings the probe takes: a backstop so a clock that never moves (a frozen
 *  test clock, a coarsened timer) cannot spin past the budget forever. */
export const TIMER_PROBE_MAX_READINGS = 2e5;

/**
 * The resolution of a clock, seconds: the smallest nonzero step between successive
 * readings over a short spin (`budgetMs`). NaN when the clock never moved.
 */
export function measureTimerResolution(now: () => number = () => performance.now(), budgetMs: number = TIMER_PROBE_MS): number {
  const start = now();
  let last = start;
  let step = Infinity;
  for (let i = 0; i < TIMER_PROBE_MAX_READINGS; i++) {
    const t = now();
    if (t > last) {
      step = Math.min(step, t - last);
      last = t;
    }
    if (t - start >= budgetMs) break;
  }
  return Number.isFinite(step) ? step / 1000 : NaN;
}

/** The page's timer checks, in a browser. */
export function runtimeChecks(): RuntimeChecks {
  const isolated = typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : null;
  const timerResolution = typeof performance !== 'undefined' ? measureTimerResolution() : NaN;
  return { crossOriginIsolated: isolated, timerResolution };
}

/** `track.getSettings()` minus the per-device identifiers. */
export function cameraSettingsOf(stream: MediaStream | null): CameraSettings | null {
  const track = stream?.getVideoTracks?.()[0];
  if (!track || typeof track.getSettings !== 'function') return null;
  const s = track.getSettings();
  return { frameRate: typeof s.frameRate === 'number' ? s.frameRate : null, width: typeof s.width === 'number' ? s.width : null, height: typeof s.height === 'number' ? s.height : null };
}

export function createTimingResource(options: TimingResourceOptions): TimingResource {
  const tracker = new TimingTracker({ audio: options.audio, now: options.now, sourceKey: options.sourceKey, runtime: options.runtime ?? runtimeChecks() });
  const bump = () => tracker.bumpEpoch();
  let boundAc: AudioContext | null = null;
  const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (devices && typeof devices.addEventListener === 'function') devices.addEventListener('devicechange', bump);

  /** The context appears on the first tap; bind to it then, once. A later context (a
   *  rebuilt engine) is another route: bind again, and the epoch moves on. */
  const bindAudio = () => {
    const ac = options.audio();
    if (!ac || ac === boundAc) return;
    if (boundAc) boundAc.removeEventListener('statechange', bump);
    boundAc = ac;
    ac.addEventListener('statechange', bump);
    bump();
  };

  const tap: Tap = {
    onValue(key, value, ctx) {
      bindAudio();
      tracker.onValue(key, value, ctx);
    },
  };

  return {
    tap,
    reading: () => tracker.reading(),
    noteCamera: (stream) => tracker.setCamera(cameraSettingsOf(stream)),
    dispose() {
      if (devices && typeof devices.removeEventListener === 'function') devices.removeEventListener('devicechange', bump);
      if (boundAc) boundAc.removeEventListener('statechange', bump);
      boundAc = null;
    },
  };
}
