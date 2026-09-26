/**
 * `?probe=latency` — the in-app latency probe and the strike test (#227).
 *
 * Opt-in by URL only, like `?slot.source=synthetic-hands`: it is a verification
 * affordance for a person with a webcam and a microphone, not an instrument
 * control, so it gets no dial and no Tools-bar entry. With the parameter absent
 * nothing here runs and no tap is attached.
 *
 * `useEngine` imports this module lazily, only when `latencyProbeRequested()`
 * (`src/latency/param.ts`) says so. With the parameter present, three things are
 * installed on the live engine:
 *
 * 1. The {@link LatencyProbe} tap: per-stage timings of the running instrument
 *    (camera period, capture → delivery, inference, tick compute, audio
 *    schedule → speaker). See `src/latency/probe.ts` for what each stage is.
 * 2. `window.thoreminLatency` — `snapshot()`, `report()` (the snapshot plus the
 *    environment: browser, camera settings, audio context), `reset()`, and the
 *    strike test's `strikeStart()` / `strikeStop()`, so the headless measurement
 *    script (`smoke/latency/`) reads exactly what a person reads.
 * 3. A small fixed panel with the same numbers, a copy-to-clipboard button and the
 *    strike-test controls.
 *
 * The strike test measures what no in-page clock can: slap a table with a flat hand
 * in view of the camera; on the frame where the hand stops, the app answers with a
 * short 3 kHz tone through its own AudioContext; the microphone hears both, and the
 * gap between the two onsets is the reactive event-to-sound latency, glass to air
 * (`src/latency/onsets.ts` explains why the microphone's own latency cancels). The
 * microphone is opened with echo cancellation, noise suppression and automatic gain
 * OFF, or the browser would remove the very tone it is listening for. Nothing is
 * recorded to disk and nothing leaves the page.
 *
 * The answer tone goes to the context's destination through its own gain, not through
 * the host master gain (so muting the instrument with `m`, which the test asks for,
 * keeps the beep) and not through the synth's internal bus; the bus's compressor
 * look-ahead is measured separately (offline, by the headless script) and added in
 * the report, not hidden in this number.
 */
import { LatencyProbe, STAGES, type AudioLike, type LatencySnapshot, type ProbeFrame } from '@/latency/probe';
import { formatSummary, summarize, type Summary } from '@/latency/stats';
import { pairStrikes, strikeOnsets, toneOnsets, TONE_DEFAULTS, type StrikePair } from '@/latency/onsets';
import { createStrikeTrigger } from '@/latency/strike';
import type { Tap } from '@/dag';

export const LATENCY_HANDLE_KEY = 'thoreminLatency';

/** Palm landmarks (MediaPipe hand indices): wrist and the four finger bases. */
const PALM = [0, 5, 9, 13, 17] as const;
/** The answer tone: frequency matches the analyser; long enough to read, short enough to tell apart. */
const ANSWER = { hz: TONE_DEFAULTS.toneHz, durationS: 0.02, rampS: 0.001, gain: 0.35 } as const;
/** Refresh period of the on-screen panel, ms. */
const PANEL_REFRESH_MS = 500;

export interface StrikeResult {
  /** Seconds of microphone audio analysed. */
  seconds: number;
  /** Answers the app played (strikes it detected). */
  triggers: number;
  /** Onsets heard: broadband (strikes and answers) and tone (answers). */
  heardStrikes: number;
  heardAnswers: number;
  pairs: StrikePair[];
  latency: Summary;
  micSettings: Record<string, unknown> | null;
}

export interface LatencyHandle {
  snapshot(): LatencySnapshot;
  report(): Record<string, unknown>;
  reset(): void;
  strikeStart(): Promise<void>;
  strikeStop(): Promise<StrikeResult>;
}

declare global {
  interface Window {
    [LATENCY_HANDLE_KEY]?: LatencyHandle;
  }
}

/** Mean normalised y of the first hand's palm, or undefined with no hand. */
function palmY(f: ProbeFrame['frame']): number | undefined {
  const hand = f.hands?.[0];
  if (!hand || !(f.height > 0)) return undefined;
  const ys = PALM.map((i) => hand.keypoints[i]?.y).filter((y): y is number => Number.isFinite(y));
  return ys.length ? ys.reduce((s, y) => s + y, 0) / ys.length / f.height : undefined;
}

/** The microphone recorder: an AudioWorklet that posts every input block. */
const RECORDER_WORKLET = `
class ThoreminLatencyRecorder extends AudioWorkletProcessor {
  process(inputs) {
    // A block with no input channel still takes up its time: post silence, or every
    // later onset would shift early.
    const ch = inputs[0] && inputs[0][0];
    this.port.postMessage(ch ? ch.slice(0) : new Float32Array(128));
    return true;
  }
}
registerProcessor('thoremin-latency-recorder', ThoreminLatencyRecorder);
`;

interface MicSession {
  ac: AudioContext;
  stream: MediaStream;
  chunks: Float32Array[];
  stopFrames: () => void;
  triggers: number;
}

function createStrikeTest(probe: LatencyProbe, getAppAudio: () => AudioContext | undefined) {
  let session: MicSession | null = null;
  /** A start in flight (the permission prompt, the worklet load): a second start waits
   *  for it instead of opening a second microphone. */
  let starting: Promise<void> | null = null;

  /** Release everything a session holds. Synchronous enough for a teardown. */
  const release = (s: MicSession) => {
    s.stopFrames();
    s.stream.getTracks().forEach((t) => t.stop());
    void s.ac.close().catch(() => {});
  };

  const answer = (ac: AudioContext) => {
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    osc.frequency.value = ANSWER.hz;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(ANSWER.gain, t0 + ANSWER.rampS);
    g.gain.setValueAtTime(ANSWER.gain, t0 + ANSWER.durationS - ANSWER.rampS);
    g.gain.linearRampToValueAtTime(0, t0 + ANSWER.durationS);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + ANSWER.durationS + 0.01);
  };

  return {
    start(): Promise<void> {
      if (session) return Promise.resolve();
      if (starting) return starting;
      const appAc = getAppAudio();
      if (!appAc || appAc.state !== 'running') return Promise.reject(new Error('Tap to play first: the strike test answers through the instrument audio.'));
      starting = (async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        const ac = new AudioContext({ latencyHint: 'interactive' });
        const s: MicSession = { ac, stream, chunks: [], triggers: 0, stopFrames: () => {} };
        try {
          const url = URL.createObjectURL(new Blob([RECORDER_WORKLET], { type: 'application/javascript' }));
          try {
            await ac.audioWorklet.addModule(url);
          } finally {
            URL.revokeObjectURL(url);
          }
          const src = ac.createMediaStreamSource(stream);
          const rec = new AudioWorkletNode(ac, 'thoremin-latency-recorder');
          const sink = ac.createGain();
          sink.gain.value = 0; // pulled by the graph, never heard
          src.connect(rec).connect(sink).connect(ac.destination);
          rec.port.onmessage = (e: MessageEvent<Float32Array>) => s.chunks.push(e.data);
        } catch (e) {
          release(s);
          throw e;
        }
        const trigger = createStrikeTrigger();
        s.stopFrames = probe.onFrame((f) => {
          if (trigger.push(f.frame.t ?? f.tickMs / 1000, palmY(f.frame))) {
            answer(appAc);
            s.triggers++;
          }
        });
        session = s;
      })().finally(() => {
        starting = null;
      });
      return starting;
    },

    /** Abandon a running session without analysing it (teardown). */
    abort(): void {
      if (session) release(session);
      session = null;
    },

    async stop(): Promise<StrikeResult> {
      const s = session;
      if (!s) throw new Error('The strike test is not running.');
      session = null;
      const micSettings = s.stream.getAudioTracks()[0]?.getSettings() ?? null;
      const sampleRate = s.ac.sampleRate;
      release(s);
      const total = s.chunks.reduce((n, c) => n + c.length, 0);
      const pcm = new Float32Array(total);
      let off = 0;
      for (const c of s.chunks) {
        pcm.set(c, off);
        off += c.length;
      }
      const strikes = strikeOnsets(pcm, sampleRate);
      const answers = toneOnsets(pcm, sampleRate);
      const pairs = pairStrikes(strikes, answers);
      return {
        seconds: total / sampleRate,
        triggers: s.triggers,
        heardStrikes: strikes.length,
        heardAnswers: answers.length,
        pairs,
        latency: summarize(pairs.map((p) => p.latencyMs)),
        micSettings: micSettings && withoutDeviceIds(micSettings),
      };
    },
  };
}

/** Track settings minus the per-device identifiers: the report is meant to be pasted
 *  into a public issue. */
function withoutDeviceIds(settings: MediaTrackSettings): Record<string, unknown> {
  const { deviceId: _d, groupId: _g, ...rest } = settings;
  return rest;
}

function environment(resources: Record<string, unknown>): Record<string, unknown> {
  const video = resources.video as HTMLVideoElement | undefined;
  const track = (video?.srcObject as MediaStream | null | undefined)?.getVideoTracks?.()[0];
  return {
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : null,
    camera: track ? withoutDeviceIds(track.getSettings()) : null,
    crossOriginIsolated: typeof window !== 'undefined' ? window.crossOriginIsolated : null,
  };
}

function mountPanel(handle: LatencyHandle): () => void {
  const panel = document.createElement('div');
  panel.setAttribute('data-testid', 'latency-probe');
  panel.style.cssText =
    'position:fixed;right:8px;bottom:8px;z-index:9999;max-width:min(560px,calc(100vw - 16px));' +
    'background:rgba(10,10,14,.88);color:#e8e8ee;font:11px/1.35 ui-monospace,monospace;' +
    'padding:8px 10px;border-radius:6px;white-space:pre-wrap;pointer-events:auto';
  const text = document.createElement('div');
  const bar = document.createElement('div');
  bar.style.cssText = 'margin-top:6px;display:flex;gap:6px;flex-wrap:wrap';
  let strikeText = '';
  let striking = false;
  const button = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:inherit;padding:2px 8px;border:1px solid #666;border-radius:4px;background:#222;color:inherit;cursor:pointer';
    b.onclick = onClick;
    bar.appendChild(b);
    return b;
  };
  button('Reset', () => handle.reset());
  button('Copy JSON', () => void navigator.clipboard?.writeText(JSON.stringify(handle.report(), null, 2)));
  const strikeBtn = button('Strike test: start', () => {
    if (!striking) {
      handle
        .strikeStart()
        .then(() => {
          striking = true;
          strikeBtn.textContent = 'Strike test: stop';
          strikeText = 'Listening. Press M to mute the instrument (the beep still plays), then slap the table with a flat hand, in view, 20+ times, a second apart.';
        })
        .catch((e: unknown) => (strikeText = `strike test: ${e instanceof Error ? e.message : String(e)}`));
    } else {
      striking = false;
      strikeBtn.textContent = 'Strike test: start';
      handle
        .strikeStop()
        .then((r) => {
          strikeText =
            `strike test: ${formatSummary(r.latency)}\n` +
            `  ${r.triggers} answers played, heard ${r.heardAnswers} answers and ${r.heardStrikes} onsets, ${r.pairs.length} paired`;
        })
        .catch((e: unknown) => (strikeText = `strike test: ${e instanceof Error ? e.message : String(e)}`));
    }
  });
  panel.append(text, bar);
  document.body.appendChild(panel);
  const render = () => {
    const s = handle.snapshot();
    const lines = STAGES.map((k) => `${k.padEnd(18)} ${formatSummary(s.stages[k])}`);
    const a = s.audio;
    const ms = (x: number | null) => (x === null ? 'n/a' : `${x.toFixed(1)} ms`);
    lines.push(`audio ${a.state ?? 'off'}  base ${ms(a.baseLatencyMs)}  output ${ms(a.outputLatencyMs)}  ${a.sampleRate ?? ''} Hz`);
    lines.push(`frames ${s.frames} (hand in ${s.framesWithHand})  stamps ${JSON.stringify(s.stampSources)}`);
    if (strikeText) lines.push(strikeText);
    text.textContent = `latency probe (#227)\n${lines.join('\n')}`;
  };
  render();
  const timer = setInterval(render, PANEL_REFRESH_MS);
  return () => {
    clearInterval(timer);
    panel.remove();
  };
}

export interface InstalledLatencyProbe {
  /** Give this to the Applier as its FIRST sink: it closes each tick's compute time. */
  tickEnd: () => void;
  /** Detach the tap, stop any strike test, remove the handle and the panel. */
  uninstall: () => void;
}

/** Attach the probe to a live engine and publish its handle and panel. */
export function installLatencyProbe(engine: { addTap(tap: Tap): () => void }, resources: Record<string, unknown>): InstalledLatencyProbe {
  const getAudio = () => resources.audioContext as AudioContext | undefined;
  const probe = new LatencyProbe({ audio: () => getAudio() as AudioLike | undefined });
  const detach = engine.addTap(probe);
  const strike = createStrikeTest(probe, getAudio);
  const handle: LatencyHandle = Object.freeze({
    snapshot: () => probe.snapshot(),
    report: () => ({ measuredAt: new Date().toISOString(), environment: environment(resources), ...probe.snapshot() }),
    reset: () => probe.reset(),
    strikeStart: () => strike.start(),
    strikeStop: () => strike.stop(),
  });
  window[LATENCY_HANDLE_KEY] = handle;
  const unmount = mountPanel(handle);
  return {
    tickEnd: () => probe.endTick(),
    uninstall: () => {
      strike.abort();
      detach();
      unmount();
      if (window[LATENCY_HANDLE_KEY] === handle) delete window[LATENCY_HANDLE_KEY];
    },
  };
}
