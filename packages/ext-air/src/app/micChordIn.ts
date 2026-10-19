/**
 * The microphone for the chord map (H8 of #613, second part: "a guitarist's open strings and a
 * singer's hum become the harmony"): while the chord map follows the microphone
 * (`chordMap.follow` = `audio`), open it, read its spectrum ten times a second through an
 * AnalyserNode, fold it into a chroma (`@thoremin/sdk/harmony/chroma`) and publish that to the
 * hot store's transient `chordMapAudio`, which `store-controls` feeds to the chord map node. Off,
 * it opens nothing (no permission prompt for a player who never asked), and closing the map, or
 * choosing another source, stops the microphone.
 *
 * Echo cancellation stays ON: without it, the chord the map itself plays comes back in through a
 * laptop's microphone, mixes with the player's next one and keeps the old one in force. Noise
 * suppression and gain control, tuned for speech, are asked off. Whether anything is sounding is
 * the room's own noise floor plus a margin (`createLevelGate`), not a fixed level, and a reading
 * is published only when it changes (silence once, a held chord rounded to two decimals), since
 * every hot-store write is a persist pass. The context is resumed (a browser creates it suspended
 * without a gesture, and a suspended analyser reads silence forever), once more on the next tap
 * or key if that was refused. The `startMidiChordIn` pattern.
 */
import { chromaFromSpectrum, createLevelGate } from '@thoremin/sdk/harmony/chroma';
import { airControls } from './controls';
import type { AudioHeard } from '../lib/audio_heard';

type MapState = { chordMap?: { enabled?: boolean; follow?: string } };

/** An open microphone: its analyser's spectrum (dB per bin) and how to close it. */
export interface MicLike {
  sampleRate: number;
  fftSize: number;
  /** The spectrum now, in dB per bin (`AnalyserNode.getFloatFrequencyData`). */
  read(): Float32Array;
  close(): void;
}

export interface MicChordInDeps {
  store?: { getState(): MapState; subscribe(l: (s: MapState) => void): () => void };
  publish?: (heard: AudioHeard | null) => void;
  /** Opens the microphone; null where the browser has none to offer. */
  open?: (() => Promise<MicLike>) | null;
  /** How the readings are paced (a test drives them by hand). */
  every?: (fn: () => void, ms: number) => () => void;
}

/** The analyser's size: 8192 bins of 5.4 Hz at 44.1 kHz, fine enough to tell E2 from F2. */
const FFT_SIZE = 8192;
/** Readings a second: what a chord change needs, without writing the store at the frame rate. */
const READ_MS = 100;

const browserOpen = (): (() => Promise<MicLike>) | null => {
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  const Ctx = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!media?.getUserMedia || !Ctx) return null;
  return async () => {
    const stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode;
    try {
      ctx = new Ctx();
      analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.5;
      ctx.createMediaStreamSource(stream).connect(analyser);
    } catch (e) {
      // Opened, then failed (a sample-rate mismatch): never leave the microphone on.
      stream.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      throw Object.assign(new Error('the microphone could not be analysed'), { cause: e, failed: true });
    }
    const live = ctx;
    const unlock = () => void live.resume().catch(() => undefined);
    await live.resume().catch(() => undefined);
    if (live.state !== 'running' && typeof window !== 'undefined') {
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }
    const db = new Float32Array(analyser.frequencyBinCount);
    return {
      sampleRate: ctx.sampleRate,
      fftSize: FFT_SIZE,
      read() {
        analyser.getFloatFrequencyData(db);
        return db;
      },
      close() {
        stream.getTracks().forEach((t) => t.stop());
        if (typeof window !== 'undefined') {
          window.removeEventListener('pointerdown', unlock);
          window.removeEventListener('keydown', unlock);
        }
        void live.close();
      },
    };
  };
};

/** The analyser's dB per bin as linear magnitudes (silence, -Infinity, is 0). */
export function magnitudesOf(db: ArrayLike<number>): Float64Array {
  const out = new Float64Array(db.length);
  for (let i = 0; i < db.length; i++) out[i] = Number.isFinite(db[i]) ? 10 ** (db[i] / 20) : 0;
  return out;
}

/** Start watching the dial; listens only while the map follows the microphone. */
export function startMicChordIn(deps: MicChordInDeps = {}): () => void {
  const store = deps.store ?? (airControls.store() as unknown as NonNullable<MicChordInDeps['store']>);
  const publish = deps.publish ?? ((heard) => airControls.setTransient('chordMapAudio', heard));
  const open = deps.open === undefined ? browserOpen() : deps.open;
  const every = deps.every ?? ((fn, ms) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  });
  let mic: MicLike | null = null;
  let stopReading: (() => void) | null = null;
  let listening = false;
  let generation = 0;
  const gate = createLevelGate();
  /** What was published last, so an unchanged reading writes nothing. */
  let lastSent = '';
  const send = (heard: AudioHeard | null) => {
    const key = JSON.stringify(heard);
    if (key === lastSent) return;
    lastSent = key;
    publish(heard);
  };

  const stop = () => {
    stopReading?.();
    stopReading = null;
    mic?.close();
    mic = null;
  };

  const apply = (s: MapState) => {
    const want = s.chordMap?.enabled === true && s.chordMap.follow === 'audio';
    if (want === listening) return;
    listening = want;
    const mine = ++generation;
    if (!want) {
      stop();
      send(null);
      return;
    }
    if (!open) {
      send({ available: false, chroma: [], sounding: false, reason: 'unsupported' });
      return;
    }
    send({ available: false, chroma: [], sounding: false, reason: 'pending' });
    open()
      .then((m) => {
        if (mine !== generation) {
          m.close();
          return;
        }
        mic = m;
        gate.reset();
        stopReading = every(() => {
          const { bins, energy } = chromaFromSpectrum(magnitudesOf(m.read()), { sampleRate: m.sampleRate, fftSize: m.fftSize });
          const sounding = gate.push(energy, READ_MS / 1000);
          send({ available: true, chroma: sounding ? bins.map((b) => Math.round(b * 100) / 100) : [], sounding });
        }, READ_MS);
      })
      .catch((e: unknown) => {
        if (mine === generation) send({ available: false, chroma: [], sounding: false, reason: (e as { failed?: boolean })?.failed ? 'failed' : 'denied' });
      });
  };
  apply(store.getState());
  const unsubscribe = store.subscribe(apply);
  return () => {
    unsubscribe();
    generation += 1;
    stop();
    send(null);
  };
}
