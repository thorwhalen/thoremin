/**
 * LyriaEngine (browser-only) — implements the {@link GenerativeEngine} facade
 * against Google Lyria RealTime via `@google/genai`. Ported from the legacy app's
 * `LyriaSession` (src/plugins/ai-dj): WebSocket session, 48 kHz stereo PCM
 * decoded + scheduled ahead through Web Audio, weighted prompts + config.
 *
 * This module statically imports `@google/genai`, so it must only ever be reached
 * via the `lyria` node's *dynamic* `import('./lyria_engine')` — which fires the
 * first time the generative layer is enabled in a browser — and is never re-exported
 * from `src/nodes/browser.ts` or `src/nodes/index.ts` (a static re-export is how the
 * SDK sat in the main chunk before #188). It is never imported by Node tests or by
 * the node itself, which depends only on the facade.
 *
 * {@link createLyriaEngine} is the default {@link GenerativeEngineFactory}: it reads
 * the player's Gemini key from the shared provider-key store (`src/keys` — the one
 * BYO-key module the assistant uses too, #133; #141 settled the posture) and
 * resolves `{ resource: null, reason: 'no-key' }` when there is none, so a panel can
 * show a key prompt instead of a dead toggle. It never throws for a missing key or
 * a missing audio graph; a truly unexpected fault rejects and the node reports it.
 *
 * API version: the SDK's default for the Gemini API is `v1beta`, and the current
 * docs' samples use it for `live.music`; the legacy plugin pinned `v1alpha`. The
 * default here follows the SDK (an override is available); confirming it against
 * the live service is a #146 item, since the engine has never been constructed.
 */
import { GoogleGenAI, type LiveMusicSession, type LiveMusicServerMessage } from '@google/genai';
import { getStoredKey } from '@/keys/providerKeys';
import type { LoadResult } from '@/lazy';
import type { GenerativeConfig, GenerativeEngine, GenerativeEngineOpts, WeightedPrompt } from './generative';

function decodeBase64(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodePcm(data: Uint8Array, ctx: AudioContext, sampleRate: number, channels: number): AudioBuffer {
  const int16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const frames = int16.length / channels;
  const buffer = ctx.createBuffer(channels, frames, sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const out = buffer.getChannelData(ch);
    for (let i = 0; i < frames; i++) out[i] = int16[i * channels + ch] / 32768;
  }
  return buffer;
}

export interface LyriaEngineOptions {
  apiKey: string;
  audioContext: AudioContext;
  /** Lyria PCM is mixed into this node (typically the app's masterGain). */
  destination: AudioNode;
  model?: string;
  bufferSeconds?: number;
  /** Gemini API version for the music session. Omitted = the SDK default (`v1beta`). */
  apiVersion?: string;
}

/** Lyria RealTime streams 48 kHz 16-bit stereo PCM. */
const LYRIA_SAMPLE_RATE = 48000;
const LYRIA_CHANNELS = 2;
const DEFAULT_MODEL = 'lyria-realtime-exp';
const DEFAULT_BUFFER_SECONDS = 2;
const GAIN_RAMP_SECONDS = 0.1;

export class LyriaEngine implements GenerativeEngine {
  private ai: GoogleGenAI;
  private model: string;
  private session: LiveMusicSession | null = null;
  private connecting: Promise<LiveMusicSession> | null = null;
  private ac: AudioContext;
  private out: GainNode;
  private dest: AudioNode;
  private nextStartTime = 0;
  private bufferTime: number;
  private playing = false;
  private volume = 1;

  constructor(opts: LyriaEngineOptions) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey, ...(opts.apiVersion ? { apiVersion: opts.apiVersion } : {}) });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.ac = opts.audioContext;
    this.dest = opts.destination;
    this.out = this.ac.createGain();
    this.bufferTime = opts.bufferSeconds ?? DEFAULT_BUFFER_SECONDS;
  }

  async connect(): Promise<void> {
    if (this.session || this.connecting) {
      await (this.connecting ?? Promise.resolve(this.session!));
      return;
    }
    this.connecting = this.ai.live.music.connect({
      model: this.model,
      callbacks: {
        onmessage: (e: LiveMusicServerMessage) => {
          if (e.serverContent?.audioChunks) this.schedule(e.serverContent.audioChunks);
        },
        onerror: () => {
          this.playing = false;
        },
        onclose: () => {
          this.playing = false;
        },
      },
    });
    try {
      this.session = await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private schedule(chunks: { data?: string; mimeType?: string }[]): void {
    if (!this.playing || !chunks[0]?.data) return;
    const buffer = decodePcm(decodeBase64(chunks[0].data), this.ac, LYRIA_SAMPLE_RATE, LYRIA_CHANNELS);
    const src = this.ac.createBufferSource();
    src.buffer = buffer;
    src.connect(this.out);
    if (this.nextStartTime === 0) this.nextStartTime = this.ac.currentTime + this.bufferTime;
    if (this.nextStartTime < this.ac.currentTime) {
      this.nextStartTime = 0; // underrun; resync next chunk
      return;
    }
    src.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  async play(): Promise<void> {
    if (!this.session) await this.connect();
    if (this.ac.state === 'suspended') await this.ac.resume();
    this.out.connect(this.dest);
    this.out.gain.setValueAtTime(0, this.ac.currentTime);
    this.out.gain.linearRampToValueAtTime(this.volume, this.ac.currentTime + GAIN_RAMP_SECONDS);
    this.playing = true;
    this.session?.play();
  }

  async pause(): Promise<void> {
    this.playing = false;
    this.session?.pause();
    this.out.gain.linearRampToValueAtTime(0, this.ac.currentTime + GAIN_RAMP_SECONDS);
    this.nextStartTime = 0;
  }

  async stop(): Promise<void> {
    this.playing = false;
    try {
      this.session?.stop();
    } catch {
      /* ignore */
    }
    try {
      this.session?.close();
    } catch {
      /* ignore */
    }
    this.session = null;
    this.out.disconnect();
    this.out = this.ac.createGain();
    this.nextStartTime = 0;
  }

  setWeightedPrompts(prompts: WeightedPrompt[]): void {
    const active = prompts.filter((p) => p.weight !== 0);
    if (!this.session || active.length === 0) return;
    void this.session.setWeightedPrompts({
      weightedPrompts: active.map((p) => ({ text: p.text, weight: p.weight })),
    });
  }

  setConfig(config: GenerativeConfig): void {
    if (!this.session) return;
    void this.session.setMusicGenerationConfig({
      musicGenerationConfig: {
        bpm: config.bpm,
        density: config.density,
        brightness: config.brightness,
        guidance: config.guidance,
        temperature: config.temperature,
      },
    });
  }

  resetContext(): void {
    this.session?.resetContext();
  }

  /** The generative bus gain (the `steer.volume` dial). Applied immediately while
   *  playing, and remembered as the level `play()` ramps up to. */
  setVolume(gain: number): void {
    this.volume = Math.min(1, Math.max(0, gain));
    if (this.playing) this.out.gain.setTargetAtTime(this.volume, this.ac.currentTime, 0.05);
  }
}

/** The provider whose key Lyria uses — the same store the assistant's Google
 *  provider reads, so one pasted key serves both. */
export const LYRIA_KEY_PROVIDER = 'google' as const;

/**
 * The default {@link GenerativeEngineFactory}: build a {@link LyriaEngine} from the
 * host audio graph and the stored Gemini key. Resolves — never throws — a null
 * result with an actionable reason when the key or the audio graph is missing.
 */
export async function createLyriaEngine(opts: GenerativeEngineOpts): Promise<LoadResult<GenerativeEngine>> {
  const apiKey = getStoredKey(LYRIA_KEY_PROVIDER);
  if (!apiKey) {
    return {
      resource: null,
      reason: 'no-key',
      message: 'Add a Gemini API key (the assistant’s Google key) to enable the generative layer.',
    };
  }
  if (!opts.audioContext || !opts.destination) {
    return { resource: null, reason: 'no-audio', message: 'Tap to play first: the generative layer needs the audio graph.' };
  }
  if (opts.signal.aborted) return { resource: null, reason: 'aborted', message: 'Cancelled' };
  const engine = new LyriaEngine({ apiKey, audioContext: opts.audioContext, destination: opts.destination });
  return { resource: engine, message: 'Generative engine ready' };
}
