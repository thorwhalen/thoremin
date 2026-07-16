/**
 * Browser FLAC encoder (#143) — the `flac` entry of the recording format registry
 * (`./formats`). The live take is captured as WebM/Opus; on stop it is decoded to an
 * `AudioBuffer` and re-encoded here as FLAC (lossless, ~half the size of a WAV, and
 * importable into essentially every DAW + Audacity) via `libflacjs`.
 *
 * This is the LICENSE-CLEAN replacement for the dropped MP3 encoder (#130/#139): every
 * npm MP3 encoder descends from LAME/shine (LGPL), whereas `libflacjs` is MIT and the
 * libFLAC it compiles in is BSD-3-Clause (Xiph) — both permissive, which the maintainer
 * needs for eventual commercialization.
 *
 * The encoder (~190 kB gzipped, the asm.js build) is NEVER imported at module load:
 * {@link loadFlacEncoder} dynamic-imports it on first use, keeping it in its own lazy
 * chunk that a player who never picks FLAC never downloads. If that import fails
 * (offline, a blocked chunk, an init timeout), {@link encodeFlac} rejects with
 * {@link FlacEncoderUnavailable} — it does not quietly hand back the un-encoded audio,
 * so the caller reports an honest failure rather than writing WebM bytes into a `.flac`.
 *
 * Like `./wav` and the former `./mp3`, `encodeFlac` takes a structural {@link PcmSource}
 * (the slice of `AudioBuffer` it reads) and an injectable `loadEncoder`, so it is
 * unit-testable headlessly with a synthetic PCM buffer and no real `AudioBuffer`.
 */
import type { PcmSource } from './wav';

/** libFLAC compression level 0–8 (higher = smaller + slower). 5 is libFLAC's own
 * default and the reference `flac` CLI default — a good size/CPU tradeoff for a take.
 * Override per call via {@link EncodeFlacOptions.compression}. */
export const DEFAULT_FLAC_COMPRESSION = 5;

/** Bit depth we quantize to. 16-bit matches the WAV (and former MP3) encoder, so all
 * three formats quantize a take identically. */
const BITS_PER_SAMPLE = 16;

/** FLAC supports up to 8 channels; a take is mono or stereo. Extra channels of a
 * multi-channel buffer are dropped (as MP3 did). */
const MAX_CHANNELS = 2;

/** Full-scale for 16-bit PCM (matches the WAV/MP3 quantization). */
const INT16_SCALE = 32767;

/** Samples per channel handed to the encoder per call. libFLAC's default block size;
 * feeding whole blocks lets us yield between them without splitting a FLAC frame. */
const BLOCK_SIZE = 4096;

/** Blocks encoded between yields — 32 blocks ≈ 3 s of audio at 44.1/48 kHz. Small
 * enough that the page stays responsive on a long take, large enough that the yields
 * cost nothing measurable. FLAC-5 is far cheaper than MP3, so this is mostly insurance. */
const YIELD_EVERY_BLOCKS = 32;

/** How long to wait for the emscripten module to report ready before giving up. The
 * asm.js build is synchronous JS parse+init, so this fires only on a genuinely stuck
 * load; it converts a hang into an honest {@link FlacEncoderUnavailable}. */
const FLAC_READY_TIMEOUT_MS = 15000;

/** Hand the event loop back so the rAF/render loop can run mid-encode. A macrotask
 * (`setTimeout`), not a microtask — a promise chain would not let paint or input through. */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The slice of the libflacjs high-level `Encoder` we drive (kept structural so a test
 * can pass a fake in place of the real, lazily-loaded one). `encode` is overloaded: with
 * a block of per-channel PCM it encodes it; with no argument it finishes the stream. */
export interface FlacEncoderLike {
  encode(pcmData: Int32Array[], numberOfSamples: number): boolean;
  encode(): boolean;
  getSamples(): Uint8Array;
  destroy(): void;
}

/** The stream geometry a FLAC encoder is constructed with. Derived from the audio, so
 * it must reach the (async) constructor — hence the factory seam below, rather than the
 * plain constructor MP3 could use. */
export interface FlacEncoderOptions {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  compression: number;
  totalSamples: number;
}

/** How to obtain a ready-to-drive encoder for one take. The default lazily imports
 * libflacjs, waits for the emscripten module to be ready, and constructs its `Encoder`;
 * tests (and any future alternative encoder) inject their own. */
export type LoadFlacEncoder = (opts: FlacEncoderOptions) => Promise<FlacEncoderLike>;

/** The FLAC encoder could not be loaded or initialized. Distinct from an encoding
 * failure so callers can tell "no encoder here" from "this audio would not encode". */
export class FlacEncoderUnavailable extends Error {
  constructor(cause?: unknown) {
    super('FLAC encoder could not be loaded', { cause });
    this.name = 'FlacEncoderUnavailable';
  }
}

export interface EncodeFlacOptions {
  /** libFLAC compression level 0–8. Defaults to {@link DEFAULT_FLAC_COMPRESSION}. */
  compression?: number;
  /** How to obtain the encoder. Defaults to {@link loadFlacEncoder}; tests inject theirs. */
  loadEncoder?: LoadFlacEncoder;
}

/**
 * The minimal slice of the Flac API object we drive. We import the asm.js build
 * (`dist/libflac.js`) directly rather than the package's Node factory entry (`index.js`,
 * which uses `require`/`path` and cannot be bundled for the browser). That direct import
 * yields the ready-gated Flac API object (no separate `.wasm`/`.mem` to locate), but the
 * package's own `.d.ts` describes the factory, not this object — so we cast the imports
 * through `unknown` to the structural shapes we actually call, below in {@link loadFlacEncoder}.
 */
interface FlacLib {
  isReady?(): boolean;
  on?(event: 'ready', cb: () => void): void;
}

/** The `Encoder` constructor from `libflacjs/lib/encoder`, narrowed to what we use. */
type FlacEncoderCtor = new (flac: unknown, options: FlacEncoderOptions) => FlacEncoderLike;

/** Resolve once the emscripten module has finished loading. Rejects (rather than hangs)
 * after {@link FLAC_READY_TIMEOUT_MS} so a stuck load surfaces as FlacEncoderUnavailable. */
function awaitFlacReady(Flac: FlacLib): Promise<void> {
  return new Promise((resolve, reject) => {
    if (Flac.isReady?.()) return resolve();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    Flac.on?.('ready', finish);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('libFLAC did not become ready in time'));
    }, FLAC_READY_TIMEOUT_MS);
  });
}

/** Lazily pull in libflacjs (the asm.js build + its high-level Encoder) and construct a
 * ready encoder. The `import()`s live HERE and nowhere else, so the encoder stays out of
 * every eagerly-loaded module. */
async function loadFlacEncoder(opts: FlacEncoderOptions): Promise<FlacEncoderLike> {
  const [flacMod, encoderMod] = await Promise.all([
    import('libflacjs/dist/libflac.js'),
    import('libflacjs/lib/encoder'),
  ]);
  // Cast through `unknown`: the package's types describe its Node factory, not the object
  // this direct dist import returns (a CJS default export at runtime — see the note above).
  const flacExports = flacMod as unknown as { default?: FlacLib };
  const Flac: FlacLib = flacExports.default ?? (flacMod as unknown as FlacLib);
  await awaitFlacReady(Flac);
  const Encoder = (encoderMod as unknown as { Encoder: FlacEncoderCtor }).Encoder;
  return new Encoder(Flac, opts);
}

/**
 * Quantize one window of float samples to 16-bit PCM stored in an `Int32Array` (what
 * libFLAC expects for 16-bit input), reusing `into` so a long take does not allocate a
 * fresh array per block. Same clamp-then-scale as `./wav`, so WAV and FLAC quantize
 * identically. Returns the filled prefix.
 */
function pcm16(src: Float32Array, offset: number, count: number, into: Int32Array): Int32Array {
  for (let i = 0; i < count; i++) {
    let s = src[offset + i] ?? 0;
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    into[i] = Math.round(s * INT16_SCALE);
  }
  return into.subarray(0, count);
}

/**
 * Encode an AudioBuffer-like source to FLAC.
 *
 * Rejects with {@link FlacEncoderUnavailable} if the encoder cannot be loaded or
 * initialized, and propagates whatever the encoder throws — it never returns a non-FLAC
 * blob. The encoder's native resources are always released (even on failure).
 */
export async function encodeFlac(audio: PcmSource, opts: EncodeFlacOptions = {}): Promise<Blob> {
  const { compression = DEFAULT_FLAC_COMPRESSION, loadEncoder = loadFlacEncoder } = opts;
  const channels = Math.min(MAX_CHANNELS, Math.max(1, audio.numberOfChannels));

  let encoder: FlacEncoderLike;
  try {
    encoder = await loadEncoder({
      sampleRate: audio.sampleRate,
      channels,
      bitsPerSample: BITS_PER_SAMPLE,
      compression,
      totalSamples: audio.length,
    });
  } catch (e) {
    throw new FlacEncoderUnavailable(e);
  }

  try {
    const src: Float32Array[] = [];
    for (let c = 0; c < channels; c++) src.push(audio.getChannelData(c));
    // One reusable Int32 block per channel (subarray'd to the real block length below).
    const blocks = Array.from({ length: channels }, () => new Int32Array(BLOCK_SIZE));

    let blocksSinceYield = 0;
    for (let i = 0; i < audio.length; i += BLOCK_SIZE) {
      const n = Math.min(BLOCK_SIZE, audio.length - i);
      const channelData = src.map((data, c) => pcm16(data, i, n, blocks[c]));
      encoder.encode(channelData, n);
      // YIELD: FLAC-5 is cheap, but a long take still runs long enough that handing the
      // event loop back every ~3 s of audio keeps the canvas/render loop alive at no
      // measurable cost (mirrors the MP3 yield fix from #139).
      if (++blocksSinceYield >= YIELD_EVERY_BLOCKS) {
        blocksSinceYield = 0;
        await yieldToEventLoop();
      }
    }
    encoder.encode(); // finish/flush the stream

    const bytes = encoder.getSamples();
    if (!bytes || bytes.length === 0) throw new Error('FLAC encoder produced no output');
    // Copy off the encoder's buffer before we destroy it (its memory is about to be freed).
    return new Blob([bytes.slice()], { type: 'audio/flac' });
  } finally {
    encoder.destroy();
  }
}
