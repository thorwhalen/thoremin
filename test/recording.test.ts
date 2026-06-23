/**
 * Tests the recording-settings building blocks (issue #49): the in-house WAV
 * encoder, the open-closed format registry, the format selection in the store,
 * the toast store, and the save helper (file-picker + download fallback). The
 * live MediaRecorder capture is browser-only and not exercised here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encodeWav, type PcmSource } from '@/app/recording/wav';
import {
  RECORDING_FORMATS,
  DEFAULT_RECORDING_FORMATS,
  recordingFormat,
} from '@/app/recording/formats';
import { useControls } from '@/app/store';
import { useToasts } from '@/app/toasts';

vi.mock('@/app/recorder', () => ({ downloadBlob: vi.fn() }));
import { downloadBlob } from '@/app/recorder';
import { saveBlob } from '@/app/recording/save';

const readView = async (blob: Blob): Promise<DataView> => new DataView(await blob.arrayBuffer());
const ascii = (v: DataView, off: number, len: number): string =>
  Array.from({ length: len }, (_, i) => String.fromCharCode(v.getUint8(off + i))).join('');

/** A structural AudioBuffer stand-in for headless encoding. */
const pcm = (channels: Float32Array[], sampleRate = 8000): PcmSource => ({
  numberOfChannels: channels.length,
  sampleRate,
  length: channels[0]?.length ?? 0,
  getChannelData: (c) => channels[c],
});

describe('encodeWav', () => {
  it('writes a correct 16-bit PCM WAV header and interleaved data', async () => {
    const blob = encodeWav(pcm([new Float32Array([0, 1, -1])], 8000));
    expect(blob.type).toBe('audio/wav');
    const v = await readView(blob);
    expect(ascii(v, 0, 4)).toBe('RIFF');
    expect(ascii(v, 8, 4)).toBe('WAVE');
    expect(ascii(v, 12, 4)).toBe('fmt ');
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(8000); // sample rate
    expect(v.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(v, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(3 * 2); // 3 mono frames * 2 bytes
    // samples: 0 -> 0, 1.0 -> 32767, -1.0 clamped -> -32767
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32767);
  });

  it('interleaves multiple channels and reports the right byte length', async () => {
    const blob = encodeWav(pcm([new Float32Array([1, 0]), new Float32Array([0, -1])], 44100));
    const v = await readView(blob);
    expect(v.getUint16(22, true)).toBe(2); // stereo
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(40, true)).toBe(2 * 2 * 2); // 2 frames * 2 ch * 2 bytes
    // frame0: L=1 -> 32767, R=0 -> 0 ; frame1: L=0 -> 0, R=-1 -> -32767
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(0);
    expect(v.getInt16(50, true)).toBe(-32767);
  });
});

describe('recording format registry', () => {
  it('defaults to the native webm format', () => {
    expect(DEFAULT_RECORDING_FORMATS).toEqual(['webm']);
    expect(recordingFormat('webm')?.needsDecode).toBe(false);
    expect(recordingFormat('wav')?.needsDecode).toBe(true);
    expect(recordingFormat('nope')).toBeUndefined();
  });

  it('webm converter passes the native blob through untouched', async () => {
    const native = new Blob(['x'], { type: 'audio/webm' });
    const convert = await recordingFormat('webm')!.load();
    expect(await convert({ native, audio: null })).toBe(native);
  });

  it('wav converter encodes the decoded audio (and errors without it)', async () => {
    const convert = await recordingFormat('wav')!.load();
    const audio = pcm([new Float32Array([0, 0.5])], 8000) as unknown as AudioBuffer;
    const out = await convert({ native: new Blob([]), audio });
    expect((out as Blob).type).toBe('audio/wav');
    expect(() => convert({ native: new Blob([]), audio: null })).toThrow();
  });

  it('every format lazily loads a converter', async () => {
    for (const f of RECORDING_FORMATS) {
      expect(typeof (await f.load())).toBe('function');
    }
  });
});

describe('store recording formats', () => {
  beforeEach(() => useControls.setState({ recordingFormats: ['webm'] }));

  it('toggles formats and always keeps at least one selected', () => {
    const s = () => useControls.getState();
    s().setRecordingFormat('wav', true);
    expect(s().recordingFormats).toEqual(['webm', 'wav']);
    s().setRecordingFormat('webm', false);
    expect(s().recordingFormats).toEqual(['wav']);
    s().setRecordingFormat('wav', false); // would empty the list -> ignored
    expect(s().recordingFormats).toEqual(['wav']);
  });
});

describe('toasts', () => {
  beforeEach(() => useToasts.setState({ toasts: [] }));

  it('pushes and dismisses', () => {
    useToasts.getState().push('Saved x.wav', 100000);
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['Saved x.wav']);
    const id = useToasts.getState().toasts[0].id;
    useToasts.getState().dismiss(id);
    expect(useToasts.getState().toasts).toEqual([]);
  });
});

describe('saveBlob', () => {
  const g = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete g.showSaveFilePicker;
    vi.mocked(downloadBlob).mockClear();
  });

  it('uses the file picker when available and returns the chosen name', async () => {
    const write = vi.fn();
    const close = vi.fn();
    g.showSaveFilePicker = vi.fn(async () => ({
      name: 'take.wav',
      createWritable: async () => ({ write, close }),
    }));
    const res = await saveBlob(new Blob(['a']), 'suggested.wav');
    expect(res).toEqual({ filename: 'take.wav', viaPicker: true });
    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('returns null when the user cancels the picker', async () => {
    g.showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError');
    });
    expect(await saveBlob(new Blob(['a']), 'x.wav')).toBeNull();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('falls back to a download (not null) on a non-cancel picker failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    g.showSaveFilePicker = vi.fn(async () => {
      throw new Error('disk full');
    });
    const res = await saveBlob(new Blob(['a']), 'x.wav');
    expect(res).toEqual({ filename: 'x.wav', viaPicker: false });
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'x.wav');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips the picker and downloads directly when allowPicker is false', async () => {
    const picker = vi.fn();
    g.showSaveFilePicker = picker;
    const res = await saveBlob(new Blob(['a']), 'x.wav', { allowPicker: false });
    expect(res).toEqual({ filename: 'x.wav', viaPicker: false });
    expect(picker).not.toHaveBeenCalled();
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'x.wav');
  });

  it('falls back to a download when no picker exists', async () => {
    const res = await saveBlob(new Blob(['a']), 'x.wav');
    expect(res).toEqual({ filename: 'x.wav', viaPicker: false });
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'x.wav');
  });
});
