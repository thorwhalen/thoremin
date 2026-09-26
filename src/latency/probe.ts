/**
 * The latency probe (#227): measures, on the RUNNING instrument, how long each stage
 * between a camera frame and the loudspeaker takes.
 *
 * It is an engine {@link Tap}, so it observes the shipped graph without changing a
 * node, and it costs nothing unless attached (the app attaches it only under
 * `?probe=latency`). What it can see, and how:
 *
 * - **Frame period** — the difference between consecutive frames' capture stamps
 *   (`FrameTiming.t`, #226): the camera's real rate, not the nominal one.
 * - **Capture → delivery** — `FrameTiming.lag` on frames stamped from the camera's
 *   `captureTime`: the OS capture pipeline plus the browser's media pipeline, up to
 *   the moment the frame pump hands the frame to inference.
 * - **Delivery → tick** — the tick's clock minus (capture + lag). The pump and the
 *   engine both run under `requestAnimationFrame`; the pump starts first, so this is
 *   the synchronous inference on the main thread plus any wait for the next tick.
 * - **Tick compute** — from the tick's clock reading to {@link LatencyProbe.endTick},
 *   which the host calls from the FIRST Applier sink, i.e. right after
 *   `engine.tick()` returns: every node (features, mapping, the synth's parameter
 *   writes, the overlay canvas), the JavaScript the "would Rust help?" question is
 *   about. (A tap alone cannot see this: the synth and the overlay declare no output
 *   ports, so no tap fires after them.) Outside a cross-origin-isolated page
 *   `performance.now()` is coarsened to about 0.1 ms, so single samples of this stage
 *   are quantised; the mean over many is still informative.
 * - **Schedule → speaker** — from `AudioContext.getOutputTimestamp()`: a parameter
 *   change written at `currentTime` during the tick is heard at the output timestamp's
 *   `performanceTime` plus `(currentTime - contextTime)`. This includes the browser's
 *   render-ahead and the output latency the OS reports; it does not include the
 *   synth's own smoothing (a stated constant, not a measurement).
 *
 * What it cannot see: the sensor's exposure and readout before `captureTime`, and
 * the DAC and loudspeaker after the reported output latency. The strike test
 * (`onsets.ts`, `strike.ts`) measures those, glass to air, with a microphone.
 *
 * Pure apart from the injected clock and audio reader; unit-tested in Node.
 */
import type { NodeContext, Tap } from '@/dag';
import type { FrameTiming, HandsFrame } from '@/nodes/domain';
import { RingSamples, type Summary } from './stats';

/** The slice of an `AudioContext` the probe reads. */
export interface AudioLike {
  readonly state: string;
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  getOutputTimestamp?(): { contextTime?: number; performanceTime?: number };
}

export type StageName =
  | 'framePeriod'
  | 'captureToDelivery'
  | 'deliveryToTick'
  | 'captureToTick'
  | 'tickPeriod'
  | 'tickCompute'
  | 'scheduleToSpeaker';

export const STAGES: readonly StageName[] = [
  'framePeriod',
  'captureToDelivery',
  'deliveryToTick',
  'captureToTick',
  'tickPeriod',
  'tickCompute',
  'scheduleToSpeaker',
];

export interface LatencySnapshot {
  /** Per-stage summaries, ms. */
  stages: Record<StageName, Summary>;
  audio: { state: string | null; sampleRate: number | null; baseLatencyMs: number | null; outputLatencyMs: number | null };
  /** How many frames were stamped from each source (`capture` is the one to trust). */
  stampSources: Record<string, number>;
  /** Frames with at least one hand / all frames seen. */
  framesWithHand: number;
  frames: number;
}

/** A new camera frame as the probe saw it, for listeners such as the strike test. */
export interface ProbeFrame {
  frame: HandsFrame & FrameTiming;
  /** The tick's clock, ms. */
  tickMs: number;
}

export interface LatencyProbeOptions {
  /** The tap key of the hands source output (`<node id>.<port>`). */
  sourceKey?: string;
  /** The clock, ms, same base as the engine's realtime clock (`performance.now()`). */
  now?: () => number;
  /** Reads the live AudioContext, if any. */
  audio?: () => AudioLike | undefined;
  /** Samples kept per stage. */
  capacity?: number;
}

export class LatencyProbe implements Tap {
  private readonly sourceKey: string;
  private readonly now: () => number;
  private readonly audio: () => AudioLike | undefined;
  private readonly samples: Record<StageName, RingSamples>;
  private readonly listeners = new Set<(f: ProbeFrame) => void>();
  private stampSources: Record<string, number> = {};
  private frames = 0;
  private framesWithHand = 0;
  private lastFrameT = NaN;
  private tick = -1;
  private tickStartMs = NaN;
  private tickClosed = true;

  constructor(options: LatencyProbeOptions = {}) {
    this.sourceKey = options.sourceKey ?? 'cam.hands';
    this.now = options.now ?? (() => performance.now());
    this.audio = options.audio ?? (() => undefined);
    const capacity = options.capacity ?? 2000;
    this.samples = Object.fromEntries(STAGES.map((s) => [s, new RingSamples(capacity)])) as Record<StageName, RingSamples>;
  }

  onValue(key: string, value: unknown, ctx: NodeContext): void {
    if (ctx.tick !== this.tick) this.startTick(ctx);
    if (key === this.sourceKey) this.onSource(value as HandsFrame & FrameTiming, ctx);
  }

  /** Call once right after each `engine.tick()` returns (the first Applier sink): closes
   *  the tick's compute time. A second call for the same tick is ignored. */
  endTick(): void {
    if (this.tickClosed || !Number.isFinite(this.tickStartMs)) return;
    this.tickClosed = true;
    this.samples.tickCompute.push(this.now() - this.tickStartMs);
  }

  /** Subscribe to each new camera frame; returns the unsubscriber. */
  onFrame(listener: (f: ProbeFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    for (const s of STAGES) this.samples[s].clear();
    this.stampSources = {};
    this.frames = 0;
    this.framesWithHand = 0;
  }

  /** Raw samples of one stage (the most recent `capacity`), for export. */
  values(stage: StageName): number[] {
    return this.samples[stage].values();
  }

  snapshot(): LatencySnapshot {
    const ac = this.audio();
    const ms = (s: number | undefined) => (typeof s === 'number' && Number.isFinite(s) ? s * 1000 : null);
    return {
      stages: Object.fromEntries(STAGES.map((s) => [s, this.samples[s].summary()])) as Record<StageName, Summary>,
      audio: {
        state: ac?.state ?? null,
        sampleRate: ac?.sampleRate ?? null,
        baseLatencyMs: ms(ac?.baseLatency),
        outputLatencyMs: ms(ac?.outputLatency),
      },
      stampSources: { ...this.stampSources },
      framesWithHand: this.framesWithHand,
      frames: this.frames,
    };
  }

  /** Open a tick: its clock reading, its period, an audio sample. */
  private startTick(ctx: NodeContext): void {
    this.tick = ctx.tick;
    this.tickStartMs = ctx.time * 1000;
    this.tickClosed = false;
    if (ctx.dt > 0) this.samples.tickPeriod.push(ctx.dt * 1000);
    this.sampleAudio();
  }

  private sampleAudio(): void {
    const ac = this.audio();
    if (!ac || ac.state !== 'running' || typeof ac.getOutputTimestamp !== 'function') return;
    const ts = ac.getOutputTimestamp();
    if (typeof ts.contextTime !== 'number' || typeof ts.performanceTime !== 'number' || !(ts.performanceTime > 0)) return;
    this.samples.scheduleToSpeaker.push(ts.performanceTime + (ac.currentTime - ts.contextTime) * 1000 - this.now());
  }

  private onSource(frame: HandsFrame & FrameTiming, ctx: NodeContext): void {
    if (!frame || typeof frame.t !== 'number' || frame.t === this.lastFrameT) return;
    const tMs = frame.t * 1000;
    const tickMs = ctx.time * 1000;
    if (Number.isFinite(this.lastFrameT)) this.samples.framePeriod.push(tMs - this.lastFrameT * 1000);
    this.lastFrameT = frame.t;
    this.frames++;
    if (frame.hands?.length) this.framesWithHand++;
    const source = frame.tSource ?? 'none';
    this.stampSources[source] = (this.stampSources[source] ?? 0) + 1;
    const lagMs = typeof frame.lag === 'number' ? frame.lag * 1000 : NaN;
    if (source === 'capture') this.samples.captureToDelivery.push(lagMs);
    if (Number.isFinite(lagMs)) this.samples.deliveryToTick.push(tickMs - (tMs + lagMs));
    if (source === 'capture') this.samples.captureToTick.push(tickMs - tMs);
    for (const l of this.listeners) l({ frame, tickMs });
  }
}
