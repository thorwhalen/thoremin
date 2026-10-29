/**
 * The page's audio-input hub, wired to the browser (`./hub.ts`; `docs/design/audio-input.md`).
 *
 * The hub runs in the app's one AudioContext, which `useEngine` creates on the first gesture
 * and announces here through {@link provideAudioOutput}; until then a lease waits. Its output
 * goes to the master gain. The worklet module is bundled by Vite as a worker chunk
 * (`?worker&url`) and loaded once per context.
 *
 * Sources: `microphone` (processing off unless every lease asks for it), `replay` (a decoded
 * file, looped), `synthetic` (seeded modal taps with known onsets, looped: the sound mapper and
 * the smoke run with no microphone). `?audio.source=` forces one.
 */
import workletUrl from './audio_in.worklet.ts?worker&url';
import { synthTake } from '@thoremin/sdk/audio/synthetic_taps';
import { AUDIO_SOURCES, createAudioInputHub, provideAudioInput, type AudioSourceKind, type ContextLike, type HubDeps, type OpenedInput, type WorkletNodeLike } from '@thoremin/sdk-ui/audio/hub';
import { storedInputStage } from './inputStage';

export type { AudioInputHub, AudioInputLease, AudioSourceKind, HubStatus, LeaseEvent } from '@thoremin/sdk-ui/audio/hub';

/** The resources key the `audio-events` node reads the hub from. */
export const AUDIO_INPUT_RESOURCE_KEY = 'audioInput';

let output: { audio(): AudioContext | undefined; destination(): AudioNode | undefined } = { audio: () => undefined, destination: () => undefined };

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

const browserDeps: HubDeps = {
  audio: () => output.audio(),
  destination: (ctx) => output.destination() ?? (ctx as AudioContext).destination,
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
  storedInputStage,
};

/** The page's one hub, installed for the extensions (`audioInput()` in `@thoremin/sdk-ui/audio/hub`). */
export const audioInput = createAudioInputHub(browserDeps);
provideAudioInput(audioInput);

/** Called by the engine host once its AudioContext and master gain exist. */
export function provideAudioOutput(o: { audio(): AudioContext | undefined; destination(): AudioNode | undefined }): void {
  output = o;
  audioInput.poke();
}

export type { ContextLike };
