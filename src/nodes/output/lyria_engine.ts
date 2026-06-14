/**
 * LyriaEngine (browser-only) — implements the {@link GenerativeEngine} facade
 * against Google Lyria RealTime via `@google/genai`. Ported from the deployed
 * app's `LyriaSession` (src/plugins/ai-dj): WebSocket session, 48 kHz stereo PCM
 * decoded + scheduled ahead through Web Audio, weighted prompts + config.
 *
 * This is the host-injected engine the `lyria` node drives (via
 * `ctx.resources.generativeEngine`). It is never imported by Node tests or by
 * the node itself (the node depends only on the facade); it is type-checked but
 * exercised only in the browser with a real API key.
 */
import { GoogleGenAI, type LiveMusicSession, type LiveMusicServerMessage } from '@google/genai';
import type { GenerativeConfig, GenerativeEngine, WeightedPrompt } from './generative';

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
  destination: GainNode;
  model?: string;
  bufferSeconds?: number;
}

export class LyriaEngine implements GenerativeEngine {
  private ai: GoogleGenAI;
  private model: string;
  private session: LiveMusicSession | null = null;
  private connecting: Promise<LiveMusicSession> | null = null;
  private ac: AudioContext;
  private out: GainNode;
  private dest: GainNode;
  private nextStartTime = 0;
  private bufferTime: number;
  private playing = false;

  constructor(opts: LyriaEngineOptions) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey, apiVersion: 'v1alpha' });
    this.model = opts.model ?? 'lyria-realtime-exp';
    this.ac = opts.audioContext;
    this.dest = opts.destination;
    this.out = this.ac.createGain();
    this.bufferTime = opts.bufferSeconds ?? 2;
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
    this.session = await this.connecting;
  }

  private schedule(chunks: { data?: string; mimeType?: string }[]): void {
    if (!this.playing || !chunks[0]?.data) return;
    const buffer = decodePcm(decodeBase64(chunks[0].data), this.ac, 48000, 2);
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
    this.out.gain.linearRampToValueAtTime(1, this.ac.currentTime + 0.1);
    this.playing = true;
    this.session?.play();
  }

  async pause(): Promise<void> {
    this.playing = false;
    this.session?.pause();
    this.out.gain.linearRampToValueAtTime(0, this.ac.currentTime + 0.1);
    this.nextStartTime = 0;
  }

  async stop(): Promise<void> {
    this.playing = false;
    try {
      this.session?.stop();
    } catch {
      /* ignore */
    }
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
}
