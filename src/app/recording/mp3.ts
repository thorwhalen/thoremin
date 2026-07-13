/**
 * Browser MP3 encoder (#130) — the `mp3` entry of the recording format registry
 * (`./formats`). The live take is captured as WebM/Opus; on stop it is decoded to
 * an `AudioBuffer` and re-encoded here as MPEG-1 Layer III via `lamejs` (the
 * maintained `@breezystack/lamejs` fork), a pure-JS LAME port.
 *
 * The encoder is ~250 kB, so it is NEVER imported at module load: `loadEncoder`
 * dynamic-imports it on first use, which keeps it in its own lazy chunk that a
 * player who never picks MP3 never downloads. If that import fails (offline, a
 * blocked chunk), {@link encodeMp3} rejects with {@link Mp3EncoderUnavailable} —
 * it does not quietly hand back the un-encoded audio, so the caller can report an
 * honest failure rather than write WebM bytes into a `.mp3`.
 *
 * Like `./wav`, `encodeMp3` takes a structural {@link PcmSource} (the slice of
 * `AudioBuffer` it reads) and an injectable `loadEncoder`, so it is unit-testable
 * headlessly with a synthetic PCM buffer and no real `AudioBuffer`.
 */
import type { PcmSource } from './wav';

/** Default output bitrate. 192 kbps is transparent enough for an instrument take
 * while staying ~10x smaller than the WAV. Override per call via
 * {@link EncodeMp3Options.bitrateKbps}. */
export const DEFAULT_MP3_BITRATE_KBPS = 192;

/** One MPEG-1 Layer III granule pair: the block size LAME expects per call. */
const SAMPLES_PER_FRAME = 1152;

/** MP3 is mono or stereo; extra channels of a multi-channel buffer are dropped. */
const MAX_CHANNELS = 2;

/** Full-scale for 16-bit PCM (matches the WAV encoder's quantization). */
const INT16_SCALE = 32767;

/** Frames encoded between yields — 128 frames ≈ 3 s of audio at 44.1/48 kHz. Small enough
 *  that the page stays responsive, large enough that the yields cost nothing measurable. */
const YIELD_EVERY_FRAMES = 128;

/** Hand the event loop back so the rAF/render loop can run mid-encode. A macrotask
 *  (`setTimeout`), not a microtask — a promise chain would not let paint or input through. */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The slice of the lamejs encoder we drive (kept structural so a test can pass a
 * fake module in place of the real, lazily-loaded one). */
export interface Mp3EncoderLike {
  encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
  flush(): Uint8Array;
}

/** The slice of the lamejs module we need: its `Mp3Encoder` constructor. */
export interface Mp3EncoderCtor {
  new (channels: number, sampleRate: number, kbps: number): Mp3EncoderLike;
}

/** The MP3 encoder could not be loaded (or the module that loaded is not one).
 * Distinct from an encoding failure so callers can tell "no encoder here" from
 * "this audio would not encode". */
export class Mp3EncoderUnavailable extends Error {
  constructor(cause?: unknown) {
    super('MP3 encoder could not be loaded', { cause });
    this.name = 'Mp3EncoderUnavailable';
  }
}

export interface EncodeMp3Options {
  /** Constant bitrate in kbps. Defaults to {@link DEFAULT_MP3_BITRATE_KBPS}. */
  bitrateKbps?: number;
  /** How to obtain the encoder. Defaults to a lazy `import()` of lamejs; tests
   * (and any future alternative encoder) inject their own. */
  loadEncoder?: () => Promise<Mp3EncoderCtor>;
}

/** Lazily pull in lamejs. The `import()` lives HERE and nowhere else, so the
 * encoder stays out of every eagerly-loaded module. */
async function loadLameEncoder(): Promise<Mp3EncoderCtor> {
  const mod = await import('@breezystack/lamejs');
  return mod.Mp3Encoder;
}

/**
 * Quantize one window of float samples to 16-bit PCM, reusing `into` (so a long
 * take does not allocate a fresh array per frame). Returns the filled prefix.
 * Same clamp-then-scale as `./wav`, so WAV and MP3 quantize identically.
 */
function pcm16(src: Float32Array, offset: number, count: number, into: Int16Array): Int16Array {
  for (let i = 0; i < count; i++) {
    let s = src[offset + i] ?? 0;
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    into[i] = Math.round(s * INT16_SCALE);
  }
  return into.subarray(0, count);
}

/** Concatenate the encoded frames into one contiguous buffer the Blob can own. */
function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Encode an AudioBuffer-like source to MP3.
 *
 * Rejects with {@link Mp3EncoderUnavailable} if the encoder cannot be loaded, and
 * propagates whatever the encoder throws (e.g. an MP3-illegal sample rate) — it
 * never returns a non-MP3 blob.
 */
export async function encodeMp3(audio: PcmSource, opts: EncodeMp3Options = {}): Promise<Blob> {
  const { bitrateKbps = DEFAULT_MP3_BITRATE_KBPS, loadEncoder = loadLameEncoder } = opts;

  let Encoder: Mp3EncoderCtor;
  try {
    Encoder = await loadEncoder();
  } catch (e) {
    throw new Mp3EncoderUnavailable(e);
  }
  if (typeof Encoder !== 'function') throw new Mp3EncoderUnavailable();

  const channels = Math.min(MAX_CHANNELS, Math.max(1, audio.numberOfChannels));
  const encoder = new Encoder(channels, audio.sampleRate, bitrateKbps);

  const left = audio.getChannelData(0);
  const right = channels > 1 ? audio.getChannelData(1) : null;
  const leftFrame = new Int16Array(SAMPLES_PER_FRAME);
  const rightFrame = right ? new Int16Array(SAMPLES_PER_FRAME) : null;

  const parts: Uint8Array[] = [];
  let framesSinceYield = 0;
  for (let i = 0; i < audio.length; i += SAMPLES_PER_FRAME) {
    const n = Math.min(SAMPLES_PER_FRAME, audio.length - i);
    const l = pcm16(left, i, n, leftFrame);
    const r = right && rightFrame ? pcm16(right, i, n, rightFrame) : undefined;
    const chunk = encoder.encodeBuffer(l, r);
    // Copy: the frame buffers above are reused, and lamejs may hand back a view.
    if (chunk.length) parts.push(new Uint8Array(chunk));
    // YIELD. `encodeBuffer` is synchronous and MP3 encoding is ~11x the cost of the WAV
    // pass over the same buffer, so encoding a whole take in one task freezes the page:
    // measured ~45x realtime on a fast machine, i.e. a 10-minute take is tens of seconds
    // of a hung tab (canvas frozen, "Page unresponsive") on a mid-range laptop. Handing
    // the event loop back every ~3 s of audio keeps the UI alive at a negligible cost.
    if (++framesSinceYield >= YIELD_EVERY_FRAMES) {
      framesSinceYield = 0;
      await yieldToEventLoop();
    }
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));

  return new Blob([concat(parts)], { type: 'audio/mpeg' });
}
