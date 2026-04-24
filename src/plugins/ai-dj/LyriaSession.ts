import {
  GoogleGenAI,
  LiveMusicSession,
  LiveMusicServerMessage,
  Scale,
} from '@google/genai';
import { AiDjSettings, Strain, PlaybackState } from './types';
import { decodeBase64, decodeAudioData } from './audioUtils';

function throttle<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let lastCall = -Infinity;
  return ((...args: any[]) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      return fn(...args);
    }
  }) as T;
}

export type LyriaEventType = 'playback-state-changed' | 'error' | 'filtered-prompt';

interface LyriaEventMap {
  'playback-state-changed': PlaybackState;
  'error': string;
  'filtered-prompt': { text: string; reason: string };
}

export class LyriaSessionManager extends EventTarget {
  private ai: GoogleGenAI;
  private model = 'lyria-realtime-exp';
  private session: LiveMusicSession | null = null;
  private sessionPromise: Promise<LiveMusicSession> | null = null;
  private audioContext: AudioContext;
  private outputNode: GainNode;
  private masterGain: GainNode;
  private nextStartTime = 0;
  private bufferTime = 2; // seconds
  private _playbackState: PlaybackState = 'stopped';
  private filteredPrompts = new Set<string>();
  private lastBpm: number | undefined;
  private lastScale: Scale | undefined;
  private sessionStartTime = 0;
  private sessionTimerId: number | null = null;

  constructor(apiKey: string, audioContext: AudioContext, masterGain: GainNode) {
    super();
    this.ai = new GoogleGenAI({ apiKey, apiVersion: 'v1alpha' });
    this.audioContext = audioContext;
    this.masterGain = masterGain;
    this.outputNode = this.audioContext.createGain();
  }

  get playbackState(): PlaybackState {
    return this._playbackState;
  }

  setVolume(volume: number) {
    this.outputNode.gain.setTargetAtTime(volume, this.audioContext.currentTime, 0.05);
  }

  get remainingSeconds(): number {
    if (this.sessionStartTime === 0) return 600;
    return Math.max(0, 600 - (Date.now() - this.sessionStartTime) / 1000);
  }

  private setPlaybackState(state: PlaybackState) {
    this._playbackState = state;
    this.dispatchEvent(new CustomEvent('playback-state-changed', { detail: state }));
  }

  private async connect(): Promise<LiveMusicSession> {
    this.sessionPromise = this.ai.live.music.connect({
      model: this.model,
      callbacks: {
        onmessage: (e: LiveMusicServerMessage) => {
          if (e.setupComplete) {
            // Connection ready
          }
          if (e.filteredPrompt) {
            this.filteredPrompts.add(e.filteredPrompt.text!);
            this.dispatchEvent(new CustomEvent('filtered-prompt', {
              detail: { text: e.filteredPrompt.text, reason: e.filteredPrompt.filteredReason }
            }));
          }
          if (e.serverContent?.audioChunks) {
            this.processAudioChunks(e.serverContent.audioChunks);
          }
        },
        onerror: () => {
          this.setPlaybackState('stopped');
          this.dispatchEvent(new CustomEvent('error', {
            detail: 'Connection error. Please try restarting.'
          }));
        },
        onclose: () => {
          this.setPlaybackState('stopped');
        },
      },
    });
    return this.sessionPromise;
  }

  private async getSession(): Promise<LiveMusicSession> {
    if (!this.session) {
      this.session = await this.connect();
    }
    return this.session;
  }

  private processAudioChunks(audioChunks: { data?: string; mimeType?: string }[]) {
    if (this._playbackState === 'paused' || this._playbackState === 'stopped') return;
    if (!audioChunks[0]?.data) return;

    const audioBuffer = decodeAudioData(
      decodeBase64(audioChunks[0].data),
      this.audioContext,
      48000,
      2,
    );

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputNode);

    if (this.nextStartTime === 0) {
      this.nextStartTime = this.audioContext.currentTime + this.bufferTime;
      setTimeout(() => {
        if (this._playbackState === 'loading') {
          this.setPlaybackState('playing');
        }
      }, this.bufferTime * 1000);
    }

    if (this.nextStartTime < this.audioContext.currentTime) {
      // Buffer underrun
      this.setPlaybackState('loading');
      this.nextStartTime = 0;
      return;
    }

    source.start(this.nextStartTime);
    this.nextStartTime += audioBuffer.duration;
  }

  readonly setWeightedPrompts = throttle(async (strains: Strain[]) => {
    const active = strains.filter(s => s.weight !== 0 && !this.filteredPrompts.has(s.text));
    if (active.length === 0) return;

    if (!this.session) return;

    try {
      await this.session.setWeightedPrompts({
        weightedPrompts: active.map(s => ({ text: s.text, weight: s.weight })),
      });
    } catch (e: any) {
      this.dispatchEvent(new CustomEvent('error', { detail: e.message }));
    }
  }, 200);

  async applyConfig(settings: AiDjSettings) {
    if (!this.session) return;

    const needsReset = (
      (this.lastBpm !== undefined && this.lastBpm !== settings.bpm) ||
      (this.lastScale !== undefined && this.lastScale !== settings.scale)
    );

    if (needsReset) {
      this.session.resetContext();
    }

    this.lastBpm = settings.bpm;
    this.lastScale = settings.scale;

    try {
      await this.session.setMusicGenerationConfig({
        musicGenerationConfig: {
          bpm: settings.bpm,
          scale: settings.scale,
          density: settings.density,
          brightness: settings.brightness,
          guidance: settings.guidance,
          temperature: settings.temperature,
          topK: settings.topK,
          muteBass: settings.muteBass,
          muteDrums: settings.muteDrums,
          onlyBassAndDrums: settings.onlyBassAndDrums,
          musicGenerationMode: settings.musicGenerationMode,
        },
      });
    } catch (e: any) {
      this.dispatchEvent(new CustomEvent('error', { detail: e.message }));
    }
  }

  async play(strains: Strain[], settings: AiDjSettings) {
    this.setPlaybackState('loading');

    const session = await this.getSession();

    // Send prompts and config
    const active = strains.filter(s => s.weight !== 0);
    if (active.length > 0) {
      await session.setWeightedPrompts({
        weightedPrompts: active.map(s => ({ text: s.text, weight: s.weight })),
      });
    }
    await this.applyConfig(settings);

    // Resume audio context
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Connect output
    this.outputNode.connect(this.masterGain);
    this.outputNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    this.outputNode.gain.linearRampToValueAtTime(1, this.audioContext.currentTime + 0.1);

    session.play();

    this.sessionStartTime = Date.now();
    // Auto-stop at 10 minute limit
    if (this.sessionTimerId) clearTimeout(this.sessionTimerId);
    this.sessionTimerId = window.setTimeout(() => {
      this.stop();
      this.dispatchEvent(new CustomEvent('error', {
        detail: 'Session reached 10-minute limit. Start a new session to continue.'
      }));
    }, 600_000);
  }

  async pause() {
    if (!this.session) return;
    this.session.pause();
    this.setPlaybackState('paused');
    this.outputNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.1);
    this.nextStartTime = 0;
  }

  async stop() {
    if (this.sessionTimerId) {
      clearTimeout(this.sessionTimerId);
      this.sessionTimerId = null;
    }
    if (this.session) {
      try { this.session.stop(); } catch { /* ignore */ }
    }
    this.setPlaybackState('stopped');
    this.outputNode.disconnect();
    this.outputNode = this.audioContext.createGain();
    this.nextStartTime = 0;
    this.sessionStartTime = 0;
  }

  async playPause(strains: Strain[], settings: AiDjSettings) {
    switch (this._playbackState) {
      case 'stopped':
      case 'paused':
        await this.play(strains, settings);
        break;
      case 'playing':
        await this.pause();
        break;
      case 'loading':
        await this.stop();
        break;
    }
  }

  disconnect() {
    this.stop();
    if (this.session) {
      try { this.session.close(); } catch { /* ignore */ }
      this.session = null;
      this.sessionPromise = null;
    }
  }
}
