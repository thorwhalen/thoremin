/**
 * Tests FLAC export (#143): the `flac` entry of the recording format registry, the
 * libflacjs adapter (`@/app/recording/flac`) driven with a synthetic PCM buffer and an
 * injected encoder, the real lazily-loaded encoder end-to-end (valid `fLaC` stream), and
 * — the point of the exercise — the FAILURE path: a format whose encoder cannot be
 * loaded must yield no blob, never the un-encoded native audio under a `.flac` name.
 *
 * FLAC is the license-clean replacement for the dropped LGPL MP3 encoder: libflacjs is
 * MIT (compiling in Xiph's BSD-3-Clause libFLAC), so it is safe for commercialization.
 *
 * Pure TS (vitest `environment: 'node'`): the adapter takes a structural PcmSource, so
 * no `AudioBuffer`, `AudioContext` or DOM is needed. The real-encode test uses the asm.js
 * libFLAC build, which loads and runs headlessly (no `.wasm`/`.mem` fetch).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  encodeFlac,
  FlacEncoderUnavailable,
  DEFAULT_FLAC_COMPRESSION,
  type FlacEncoderLike,
  type FlacEncoderOptions,
  type LoadFlacEncoder,
} from '@/app/recording/flac';
import {
  RECORDING_FORMATS,
  recordingFormat,
  convertAudioFormats,
} from '@/app/recording/formats';
import type { PcmSource } from '@/app/recording/wav';

/** A structural AudioBuffer stand-in for headless encoding (as in recording.test.ts). */
const pcm = (channels: Float32Array[], sampleRate = 44100): PcmSource => ({
  numberOfChannels: channels.length,
  sampleRate,
  length: channels[0]?.length ?? 0,
  getChannelData: (c) => channels[c],
});

/** A ramp of `n` samples in [-1, 1] — enough signal for the encoder to chew on. */
const ramp = (n: number): Float32Array =>
  Float32Array.from({ length: n }, (_, i) => Math.sin((i / n) * 2 * Math.PI));

interface FakeCalls {
  ctor: FlacEncoderOptions[];
  blocks: { channels: number[][]; n: number }[];
  finished: number;
  destroyed: number;
}

/** A fake libflacjs Encoder factory that records exactly how the adapter drove it and
 * emits one recognizable byte per encoded block (+ a tail marker), so the output bytes
 * are checkable. `emptyOutput` exercises the "produced no output" guard. */
function fakeEncoder(opts: { emptyOutput?: boolean } = {}): { load: LoadFlacEncoder; calls: FakeCalls } {
  const calls: FakeCalls = { ctor: [], blocks: [], finished: 0, destroyed: 0 };
  const load: LoadFlacEncoder = async (ctorOpts) => {
    calls.ctor.push(ctorOpts);
    const encoder: FlacEncoderLike = {
      encode(pcmData?: Int32Array[], n?: number): boolean {
        if (pcmData === undefined) {
          calls.finished++;
          return true;
        }
        calls.blocks.push({ channels: pcmData.map((c) => [...c]), n: n ?? 0 });
        return true;
      },
      getSamples(): Uint8Array {
        if (opts.emptyOutput) return new Uint8Array();
        const b = new Uint8Array(calls.blocks.length + 1);
        b.fill(1, 0, calls.blocks.length);
        b[calls.blocks.length] = 9;
        return b;
      },
      destroy(): void {
        calls.destroyed++;
      },
    };
    return encoder;
  };
  return { load, calls };
}

describe('flac format registry entry', () => {
  it('is registered, needs decoded audio, and carries the flac extension', () => {
    const fmt = recordingFormat('flac');
    expect(fmt).toBeDefined();
    expect(fmt?.ext).toBe('flac');
    expect(fmt?.needsDecode).toBe(true);
    // RecordButton renders RECORDING_FORMATS, so being in the list IS being offered to
    // the user — there is no separate UI list to keep in sync.
    expect(RECORDING_FORMATS.map((f) => f.id)).toContain('flac');
  });

  it('converts decoded audio to an audio/flac blob (and errors without it)', async () => {
    const convert = await recordingFormat('flac')!.load();
    const audio = pcm([ramp(4096)]) as unknown as AudioBuffer;
    const out = await convert({ native: new Blob([]), audio });
    expect(out.type).toBe('audio/flac');
    expect(out.size).toBeGreaterThan(0);
    await expect(async () => convert({ native: new Blob([]), audio: null })).rejects.toThrow(
      /decoded audio/i,
    );
  });
});

describe('encodeFlac', () => {
  it('constructs the encoder with the buffer geometry and the default compression', async () => {
    const { load, calls } = fakeEncoder();
    await encodeFlac(pcm([ramp(10), ramp(10)], 48000), { loadEncoder: load });
    expect(calls.ctor).toEqual([
      { sampleRate: 48000, channels: 2, bitsPerSample: 16, compression: DEFAULT_FLAC_COMPRESSION, totalSamples: 10 },
    ]);
    expect(DEFAULT_FLAC_COMPRESSION).toBe(5);
  });

  it('honours an explicit compression level', async () => {
    const { load, calls } = fakeEncoder();
    await encodeFlac(pcm([ramp(10)]), { loadEncoder: load, compression: 8 });
    expect(calls.ctor[0].compression).toBe(8);
  });

  it('quantizes to 16-bit PCM with the same clamp/scale as the WAV encoder', async () => {
    const { load, calls } = fakeEncoder();
    const samples = new Float32Array([0, 1, -1, 2, -2, 0.5]);
    await encodeFlac(pcm([samples]), { loadEncoder: load });
    // 2.0 clamps to 1.0 -> 32767 ; -2.0 clamps to -1.0 -> -32767 ; 0.5 -> 16384 (round)
    expect(calls.blocks[0].channels[0]).toEqual([0, 32767, -32767, 32767, -32767, 16384]);
    expect(calls.blocks[0].channels).toHaveLength(1); // mono: one channel array
  });

  it('feeds the encoder in 4096-sample blocks and finishes the stream', async () => {
    const { load, calls } = fakeEncoder();
    const blob = await encodeFlac(pcm([ramp(4096 * 2 + 5)]), { loadEncoder: load });
    expect(calls.blocks.map((b) => b.n)).toEqual([4096, 4096, 5]);
    expect(calls.blocks.map((b) => b.channels[0].length)).toEqual([4096, 4096, 5]);
    expect(calls.finished).toBe(1);
    expect(calls.destroyed).toBe(1);
    expect(blob.type).toBe('audio/flac');
  });

  it('passes both channels for stereo, and drops channels beyond the second', async () => {
    const { load, calls } = fakeEncoder();
    const l = new Float32Array([1, 0]);
    const r = new Float32Array([-1, 0]);
    const extra = new Float32Array([0.5, 0.5]);
    await encodeFlac(pcm([l, r, extra]), { loadEncoder: load });
    expect(calls.ctor[0].channels).toBe(2); // capped at stereo
    expect(calls.blocks[0].channels).toHaveLength(2);
    expect(calls.blocks[0].channels[0]).toEqual([32767, 0]);
    expect(calls.blocks[0].channels[1]).toEqual([-32767, 0]);
  });

  it('really encodes with the lazily-loaded libflacjs (fLaC stream marker in the bytes)', async () => {
    const blob = await encodeFlac(pcm([ramp(4096), ramp(4096)], 44100));
    expect(blob.type).toBe('audio/flac');
    const data = new Uint8Array(await blob.arrayBuffer());
    expect(data.length).toBeGreaterThan(100);
    // Every native FLAC stream begins with the four-byte magic "fLaC".
    expect(String.fromCharCode(data[0], data[1], data[2], data[3])).toBe('fLaC');
  });
});

describe('encodeFlac failure path', () => {
  it('rejects with FlacEncoderUnavailable when the encoder will not load', async () => {
    const boom = new Error('chunk load failed');
    await expect(
      encodeFlac(pcm([ramp(10)]), {
        loadEncoder: async () => {
          throw boom;
        },
      }),
    ).rejects.toBeInstanceOf(FlacEncoderUnavailable);
  });

  it('keeps the underlying load error as the cause', async () => {
    const boom = new Error('chunk load failed');
    const err = await encodeFlac(pcm([ramp(10)]), {
      loadEncoder: async () => {
        throw boom;
      },
    }).catch((e: unknown) => e);
    expect((err as Error).cause).toBe(boom);
  });

  it('propagates an encoding failure instead of returning a non-FLAC blob', async () => {
    const load: LoadFlacEncoder = async () => ({
      encode() {
        throw new Error('unsupported sample rate');
      },
      getSamples: () => new Uint8Array(),
      destroy: () => {},
    });
    await expect(
      encodeFlac(pcm([ramp(10)], 12345), { loadEncoder: load }),
    ).rejects.toThrow(/unsupported sample rate/);
  });

  it('rejects rather than returning an empty blob when the encoder produces no output', async () => {
    const { load } = fakeEncoder({ emptyOutput: true });
    await expect(encodeFlac(pcm([ramp(10)]), { loadEncoder: load })).rejects.toThrow(/no output/i);
  });

  it('always releases the encoder, even when encoding throws', async () => {
    let destroyed = 0;
    const load: LoadFlacEncoder = async () => ({
      encode() {
        throw new Error('boom');
      },
      getSamples: () => new Uint8Array([1]),
      destroy() {
        destroyed++;
      },
    });
    await encodeFlac(pcm([ramp(10)]), { loadEncoder: load }).catch(() => {});
    expect(destroyed).toBe(1);
  });
});

describe('convertAudioFormats with flac', () => {
  const native = new Blob(['native-webm-bytes'], { type: 'audio/webm' });

  it('returns one outcome per id, in order, with the encoded blobs', async () => {
    const audio = pcm([ramp(4096)]) as unknown as AudioBuffer;
    const out = await convertAudioFormats(['webm', 'wav', 'flac'], { native, audio });
    expect(out.map((o) => o.id)).toEqual(['webm', 'wav', 'flac']);
    expect(out.map((o) => o.blob?.type)).toEqual(['audio/webm', 'audio/wav', 'audio/flac']);
  });

  it('reports a failed format as a null blob — never the un-encoded native audio', async () => {
    // audio: null makes every decode-needing converter (wav, flac) fail, exactly as a
    // failed decode or a failed lazy encoder chunk would.
    const out = await convertAudioFormats(['webm', 'flac', 'wav'], { native, audio: null });
    expect(out.map((o) => o.id)).toEqual(['webm', 'flac', 'wav']); // positions preserved
    expect(out[0].blob).toBe(native); // the native passthrough still works
    expect(out[1].blob).toBeNull();
    expect(out[2].blob).toBeNull();
    expect(out[1].error).toBeInstanceOf(Error);
    // The whole point: no silent fallback to the native blob under a flac/wav name.
    expect(out.some((o) => o.id !== 'webm' && o.blob === native)).toBe(false);
  });

  it('contains a failure to its own format (a broken flac does not lose the wav)', async () => {
    const flac = recordingFormat('flac')!;
    const load = vi.spyOn(flac, 'load').mockRejectedValue(new FlacEncoderUnavailable());
    try {
      const audio = pcm([ramp(4096)]) as unknown as AudioBuffer;
      const out = await convertAudioFormats(['flac', 'wav'], { native, audio });
      expect(out[0]).toMatchObject({ id: 'flac', blob: null });
      expect(out[0].error).toBeInstanceOf(FlacEncoderUnavailable);
      expect(out[1].blob?.type).toBe('audio/wav');
    } finally {
      load.mockRestore();
    }
  });
});

describe('the encode does not freeze the page', () => {
  // libflacjs's encode is synchronous per block, so encoding a long take in ONE task
  // would hang the tab. The loop must hand the event loop back periodically (mirrors the
  // MP3 yield fix from #139).
  it('yields to the event loop during a multi-block encode', async () => {
    const { load } = fakeEncoder();
    // Long enough to cross the yield threshold (32 blocks x 4096 samples).
    const audio = pcm([ramp(40 * 4096)]);

    // A macrotask queued BEFORE the encode. If the encode never yields, it cannot run
    // until the encode has finished — which is exactly what a frozen page is.
    let macrotaskRan = false;
    setTimeout(() => {
      macrotaskRan = true;
    }, 0);

    await encodeFlac(audio, { loadEncoder: load });
    expect(macrotaskRan).toBe(true);
  });

  it('a long take still encodes every block correctly (the yield never drops one)', async () => {
    const { load, calls } = fakeEncoder();
    const audio = pcm([ramp(40 * 4096)]);
    const blob = await encodeFlac(audio, { loadEncoder: load });
    expect(calls.blocks).toHaveLength(40); // every block encoded, none skipped by a yield
    expect(calls.finished).toBe(1);
    expect(blob.type).toBe('audio/flac');
  });
});
