/**
 * The audio-input hub's browser half, for any page (`docs/design/audio-input.md`): the worklet
 * loaded once per context, the three sources (`microphone` with processing off unless every
 * lease asks, `replay` a decoded file looped, `synthetic` seeded modal taps looped) and the
 * `?audio.source=` override. It knows nothing of the app shell: the page says which
 * AudioContext and which destination (`BrowserAudioOutput`), and where a measured input stage
 * is kept, if anywhere.
 *
 * The app installs one over its engine's context (`src/app/audio/index.ts`); a standalone game
 * page makes its own over a context of its own (`play/`), and so pulls in this, the hub
 * and the worklet, and nothing of the shell.
 */
import workletUrl from './audio_in.worklet.ts?worker&url';
import { synthTake } from '@thoremin/sdk/audio/synthetic_taps';
import { AUDIO_SOURCES, createAudioInputHub, type AudioInputHub, type AudioSourceKind, type HubDeps, type OpenedInput, type WorkletNodeLike } from '@thoremin/sdk-ui/audio/hub';
import type { InputStage } from '@thoremin/sdk/timing/input_stage';

export interface BrowserAudioOutput {
  /** The context the input runs in; undefined until the page has one (the hub waits). */
  audio(): AudioContext | undefined;
  /** Where a triggered sound goes (default: the context's destination). */
  destination?(): AudioNode | undefined;
}

export interface BrowserAudioInputOptions {
  /** A measured input stage kept by the page, or null (the hub falls back to the prior). */
  storedInputStage?: () => InputStage | null;
}

const loaded = new WeakMap<object, Promise<void>>();

function bufferOf(ctx: AudioContext, pcm: Float32Array, sampleRate: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.max(1, pcm.length), sampleRate);
  b.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  return b;
}

function loop(ctx: AudioContext, buffer: AudioBuffer): OpenedInput {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start();
  return {
    source: src,
    close() {
      try {
        src.stop();
      } catch {
        // already stopped
      }
      src.disconnect();
    },
  };
}

/** The hub's browser dependencies over `output`. */
export function browserHubDeps(output: BrowserAudioOutput, options: BrowserAudioInputOptions = {}): HubDeps {
  return {
    audio: () => output.audio(),
    destination: (ctx) => output.destination?.() ?? (ctx as AudioContext).destination,
    async makeNode(c) {
      const ctx = c as AudioContext;
      if (!ctx.audioWorklet) throw Object.assign(new Error('this browser has no AudioWorklet'), { unsupported: true });
      let p = loaded.get(ctx);
      if (!p) {
        p = ctx.audioWorklet.addModule(workletUrl);
        loaded.set(ctx, p);
      }
      await p;
      return new AudioWorkletNode(ctx, 'thoremin-audio-in', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 1,
        channelCountMode: 'explicit',
      }) as unknown as WorkletNodeLike;
    },
    async open(c, kind, { constraints, replay }) {
      const ctx = c as AudioContext;
      if (kind === 'synthetic') {
        const take = synthTake({ sampleRate: ctx.sampleRate, seed: 1, perSurface: 6, gapMin: 0.35, gapMax: 0.7 });
        return loop(ctx, bufferOf(ctx, take.pcm, take.sampleRate));
      }
      if (kind === 'replay') {
        if (!replay) throw new Error('no file loaded to replay');
        return loop(ctx, bufferOf(ctx, replay.pcm, replay.sampleRate));
      }
      const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
      if (!media?.getUserMedia) throw Object.assign(new Error('this browser offers no microphone'), { unsupported: true });
      let stream: MediaStream;
      try {
        stream = await media.getUserMedia({ audio: { ...constraints, channelCount: 1 } });
      } catch (e) {
        const name = (e as { name?: string })?.name;
        throw Object.assign(new Error(String((e as Error)?.message ?? e)), { denied: name === 'NotAllowedError' || name === 'SecurityError' });
      }
      const track = stream.getAudioTracks()[0];
      const settings = (track?.getSettings?.() ?? {}) as MediaTrackSettings & { latency?: number };
      let src: MediaStreamAudioSourceNode;
      try {
        src = ctx.createMediaStreamSource(stream);
      } catch (e) {
        // Opened, then failed (a sample-rate mismatch): never leave the microphone on.
        stream.getTracks().forEach((t) => t.stop());
        throw e;
      }
      return {
        source: src,
        reportedLatency: typeof settings.latency === 'number' ? settings.latency : undefined,
        device: track?.label || undefined,
        close() {
          src.disconnect();
          stream.getTracks().forEach((t) => t.stop());
        },
      };
    },
    forcedSource() {
      if (typeof window === 'undefined') return null;
      const v = new URLSearchParams(window.location.search).get('audio.source');
      return v && (AUDIO_SOURCES as readonly string[]).includes(v) ? (v as AudioSourceKind) : null;
    },
    storedInputStage: options.storedInputStage ?? (() => null),
  };
}

/** A hub over `output` (the page keeps it; call `poke()` once its context exists). */
export function createBrowserAudioInput(output: BrowserAudioOutput, options: BrowserAudioInputOptions = {}): AudioInputHub {
  return createAudioInputHub(browserHubDeps(output, options));
}
