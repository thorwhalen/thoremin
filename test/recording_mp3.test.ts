/**
 * Tests MP3 export (#130): the `mp3` entry of the recording format registry, the
 * lamejs adapter (`@/app/recording/mp3`) driven with a synthetic PCM buffer and an
 * injected encoder, the real lazily-loaded encoder end-to-end, and — the point of
 * the exercise — the FAILURE path: a format whose encoder cannot be loaded must
 * yield no blob, never the un-encoded native audio under an `.mp3` name.
 *
 * Pure TS (vitest `environment: 'node'`): the adapter takes a structural PcmSource,
 * so no `AudioBuffer`, `AudioContext` or DOM is needed.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  encodeMp3,
  Mp3EncoderUnavailable,
  DEFAULT_MP3_BITRATE_KBPS,
  type Mp3EncoderCtor,
  type Mp3EncoderLike,
} from '@/app/recording/mp3';
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
  ctor: { channels: number; sampleRate: number; kbps: number }[];
  blocks: { left: number[]; right: number[] | null }[];
  flushed: number;
}

/** A fake lamejs `Mp3Encoder` that records exactly how the adapter drove it and
 * emits one recognizable byte per call, so the output bytes are checkable. */
function fakeEncoder(): { Ctor: Mp3EncoderCtor; calls: FakeCalls } {
  const calls: FakeCalls = { ctor: [], blocks: [], flushed: 0 };
  class Fake implements Mp3EncoderLike {
    constructor(channels: number, sampleRate: number, kbps: number) {
      calls.ctor.push({ channels, sampleRate, kbps });
    }
    encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array {
      calls.blocks.push({ left: [...left], right: right ? [...right] : null });
      return new Uint8Array([1, left.length & 0xff]);
    }
    flush(): Uint8Array {
      calls.flushed++;
      return new Uint8Array([9]);
    }
  }
  return { Ctor: Fake, calls };
}

const bytes = async (blob: Blob): Promise<number[]> => [...new Uint8Array(await blob.arrayBuffer())];

describe('mp3 format registry entry', () => {
  it('is registered, needs decoded audio, and carries the mp3 extension', () => {
    const fmt = recordingFormat('mp3');
    expect(fmt).toBeDefined();
    expect(fmt?.ext).toBe('mp3');
    expect(fmt?.needsDecode).toBe(true);
    // The settings sheet renders RECORDING_FORMATS, so being in the list IS being
    // offered to the user — there is no separate UI list to keep in sync.
    expect(RECORDING_FORMATS.map((f) => f.id)).toContain('mp3');
  });

  it('converts decoded audio to an audio/mpeg blob (and errors without it)', async () => {
    const convert = await recordingFormat('mp3')!.load();
    const audio = pcm([ramp(2400)]) as unknown as AudioBuffer;
    const out = await convert({ native: new Blob([]), audio });
    expect(out.type).toBe('audio/mpeg');
    expect(out.size).toBeGreaterThan(0);
    await expect(async () => convert({ native: new Blob([]), audio: null })).rejects.toThrow(
      /decoded audio/i,
    );
  });
});

describe('encodeMp3', () => {
  it('drives the encoder with the buffer geometry and the default bitrate', async () => {
    const { Ctor, calls } = fakeEncoder();
    await encodeMp3(pcm([ramp(10), ramp(10)], 48000), { loadEncoder: async () => Ctor });
    expect(calls.ctor).toEqual([{ channels: 2, sampleRate: 48000, kbps: DEFAULT_MP3_BITRATE_KBPS }]);
    expect(DEFAULT_MP3_BITRATE_KBPS).toBe(192);
  });

  it('honours an explicit bitrate', async () => {
    const { Ctor, calls } = fakeEncoder();
    await encodeMp3(pcm([ramp(10)]), { loadEncoder: async () => Ctor, bitrateKbps: 320 });
    expect(calls.ctor[0].kbps).toBe(320);
  });

  it('quantizes to 16-bit PCM with the same clamp/scale as the WAV encoder', async () => {
    const { Ctor, calls } = fakeEncoder();
    const samples = new Float32Array([0, 1, -1, 2, -2, 0.5]);
    await encodeMp3(pcm([samples]), { loadEncoder: async () => Ctor });
    // 2.0 clamps to 1.0 -> 32767 ; -2.0 clamps to -1.0 -> -32767 ; 0.5 -> 16384 (round)
    expect(calls.blocks[0].left).toEqual([0, 32767, -32767, 32767, -32767, 16384]);
    expect(calls.blocks[0].right).toBeNull(); // mono: no right channel passed
  });

  it('feeds the encoder in 1152-sample frames and appends flush()', async () => {
    const { Ctor, calls } = fakeEncoder();
    const blob = await encodeMp3(pcm([ramp(1152 * 2 + 5)]), { loadEncoder: async () => Ctor });
    expect(calls.blocks.map((b) => b.left.length)).toEqual([1152, 1152, 5]);
    expect(calls.flushed).toBe(1);
    // 3 encodeBuffer chunks ([1, len & 0xff]) then the flush tail ([9]).
    expect(await bytes(blob)).toEqual([1, 1152 & 0xff, 1, 1152 & 0xff, 1, 5, 9]);
    expect(blob.type).toBe('audio/mpeg');
  });

  it('passes both channels for stereo, and drops channels beyond the second', async () => {
    const { Ctor, calls } = fakeEncoder();
    const l = new Float32Array([1, 0]);
    const r = new Float32Array([-1, 0]);
    const extra = new Float32Array([0.5, 0.5]);
    await encodeMp3(pcm([l, r, extra]), { loadEncoder: async () => Ctor });
    expect(calls.ctor[0].channels).toBe(2); // MP3 is mono/stereo only
    expect(calls.blocks[0].left).toEqual([32767, 0]);
    expect(calls.blocks[0].right).toEqual([-32767, 0]);
  });

  it('really encodes with the lazily-loaded lamejs (MP3 frame sync in the bytes)', async () => {
    const blob = await encodeMp3(pcm([ramp(4096), ramp(4096)], 44100));
    expect(blob.type).toBe('audio/mpeg');
    const data = new Uint8Array(await blob.arrayBuffer());
    expect(data.length).toBeGreaterThan(100);
    // Every MP3 frame starts with 11 set sync bits: 0xFF followed by 0xEx/0xFx.
    expect(data[0]).toBe(0xff);
    expect(data[1] & 0xe0).toBe(0xe0);
  });
});

describe('encodeMp3 failure path', () => {
  it('rejects with Mp3EncoderUnavailable when the encoder will not load', async () => {
    const boom = new Error('chunk load failed');
    await expect(
      encodeMp3(pcm([ramp(10)]), {
        loadEncoder: async () => {
          throw boom;
        },
      }),
    ).rejects.toBeInstanceOf(Mp3EncoderUnavailable);
  });

  it('keeps the underlying load error as the cause', async () => {
    const boom = new Error('chunk load failed');
    const err = await encodeMp3(pcm([ramp(10)]), {
      loadEncoder: async () => {
        throw boom;
      },
    }).catch((e: unknown) => e);
    expect((err as Error).cause).toBe(boom);
  });

  it('rejects with Mp3EncoderUnavailable when the loaded module is not an encoder', async () => {
    await expect(
      encodeMp3(pcm([ramp(10)]), {
        loadEncoder: async () => undefined as unknown as Mp3EncoderCtor,
      }),
    ).rejects.toBeInstanceOf(Mp3EncoderUnavailable);
  });

  it('propagates an encoding failure instead of returning a non-MP3 blob', async () => {
    const Ctor = class implements Mp3EncoderLike {
      encodeBuffer(): Uint8Array {
        throw new Error('unsupported sample rate');
      }
      flush(): Uint8Array {
        return new Uint8Array();
      }
    } as unknown as Mp3EncoderCtor;
    await expect(
      encodeMp3(pcm([ramp(10)], 12345), { loadEncoder: async () => Ctor }),
    ).rejects.toThrow(/unsupported sample rate/);
  });
});

describe('convertAudioFormats', () => {
  const native = new Blob(['native-webm-bytes'], { type: 'audio/webm' });

  it('returns one outcome per id, in order, with the encoded blobs', async () => {
    const audio = pcm([ramp(1200)]) as unknown as AudioBuffer;
    const out = await convertAudioFormats(['webm', 'wav', 'mp3'], { native, audio });
    expect(out.map((o) => o.id)).toEqual(['webm', 'wav', 'mp3']);
    expect(out.map((o) => o.blob?.type)).toEqual(['audio/webm', 'audio/wav', 'audio/mpeg']);
  });

  it('reports a failed format as a null blob — never the un-encoded native audio', async () => {
    // audio: null makes every decode-needing converter (wav, mp3) fail, exactly as a
    // failed decode or a failed lazy encoder chunk would.
    const out = await convertAudioFormats(['webm', 'mp3', 'wav'], { native, audio: null });
    expect(out.map((o) => o.id)).toEqual(['webm', 'mp3', 'wav']); // positions preserved
    expect(out[0].blob).toBe(native); // the native passthrough still works
    expect(out[1].blob).toBeNull();
    expect(out[2].blob).toBeNull();
    expect(out[1].error).toBeInstanceOf(Error);
    // The whole point: no silent fallback to the native blob under an mp3/wav name.
    expect(out.some((o) => o.id !== 'webm' && o.blob === native)).toBe(false);
  });

  it('contains a failure to its own format (a broken mp3 does not lose the wav)', async () => {
    const mp3 = recordingFormat('mp3')!;
    const load = vi.spyOn(mp3, 'load').mockRejectedValue(new Mp3EncoderUnavailable());
    try {
      const audio = pcm([ramp(1200)]) as unknown as AudioBuffer;
      const out = await convertAudioFormats(['mp3', 'wav'], { native, audio });
      expect(out[0]).toMatchObject({ id: 'mp3', blob: null });
      expect(out[0].error).toBeInstanceOf(Mp3EncoderUnavailable);
      expect(out[1].blob?.type).toBe('audio/wav');
    } finally {
      load.mockRestore();
    }
  });

  it('reports an unknown id as a failure rather than shifting the results', async () => {
    const out = await convertAudioFormats(['nope', 'webm'], { native, audio: null });
    expect(out.map((o) => o.id)).toEqual(['nope', 'webm']);
    expect(out[0].blob).toBeNull();
    expect(out[1].blob).toBe(native);
  });
});

describe('the encode does not freeze the page', () => {
  // MP3 encoding is ~11x the cost of the WAV pass over the same buffer and lamejs's
  // encodeBuffer is synchronous, so encoding a take in ONE task hangs the tab: ~45x
  // realtime on a fast machine, i.e. tens of seconds of frozen canvas for a 10-minute
  // take on a mid-range laptop. The loop must hand the event loop back periodically.
  it('yields to the event loop during a multi-frame encode', async () => {
    const { Ctor } = fakeEncoder();
    // Long enough to cross the yield threshold (128 frames x 1152 samples).
    const audio = pcm([ramp(300 * 1152)]);

    // A macrotask queued BEFORE the encode. If the encode never yields, it cannot run
    // until the encode has finished — which is exactly what a frozen page is.
    let macrotaskRan = false;
    setTimeout(() => {
      macrotaskRan = true;
    }, 0);

    await encodeMp3(audio, { loadEncoder: async () => Ctor });
    expect(macrotaskRan).toBe(true);
  });

  it('a SHORT take still encodes correctly (the yield never drops a frame)', async () => {
    const { Ctor, calls } = fakeEncoder();
    const audio = pcm([ramp(300 * 1152)]);
    const blob = await encodeMp3(audio, { loadEncoder: async () => Ctor });
    expect(calls.blocks).toHaveLength(300); // every frame encoded, none skipped by a yield
    expect(calls.flushed).toBe(1);
    expect(blob.type).toBe('audio/mpeg');
  });
});
