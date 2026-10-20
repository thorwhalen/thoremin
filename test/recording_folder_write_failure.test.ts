/**
 * A folder write that fails at stop must not lose the take (#308). The folder was
 * deleted, its permission revoked or the disk filled between the start of the take and
 * its stop: the directory sink switches to a zip holding every file added so far
 * (including the ones it had already written to the folder) and every later one, the
 * manifest last, and reports the fall-back so the player is told.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unzipSync } from 'fflate';

vi.mock('@/app/recording/recorder', () => ({ downloadBlob: vi.fn() }));
import { downloadBlob } from '@/app/recording/recorder';
import { createRecordingSink } from '@/app/recording/sink';
import type { FsDirHandle } from '@/app/recording/folder';

const g = globalThis as unknown as { showDirectoryPicker?: unknown };

/** A base folder whose take subfolder accepts `okWrites` files, then throws on `createWritable`. */
function flakyBase(okWrites: number) {
  const written: Record<string, string> = {};
  let n = 0;
  const sub = {
    name: 'take',
    getDirectoryHandle: async () => {
      throw new DOMException('not used', 'NotSupportedError');
    },
    getFileHandle: async (file: string) => ({
      createWritable: async () => {
        if (n++ >= okWrites) throw new DOMException('the folder is gone', 'NotFoundError');
        return {
          write: async (data: Blob | string) => {
            written[file] = typeof data === 'string' ? data : '<binary>';
          },
          close: async () => undefined,
        };
      },
    }),
  };
  let made = false;
  const base = {
    name: 'takes',
    getDirectoryHandle: async (_: string, opts?: { create?: boolean }) => {
      if (!made && !opts?.create) throw new DOMException('free', 'NotFoundError');
      made = true;
      return sub;
    },
    getFileHandle: async () => {
      throw new DOMException('not used', 'NotSupportedError');
    },
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  } as unknown as FsDirHandle;
  return { base, written };
}

const FILES: [string, Blob | string][] = [
  ['features.ndjson', '{"t":0}\n'],
  ['audio.wav', new Blob([new Uint8Array([82, 73, 70, 70])])],
  ['video.webm', new Blob([new Uint8Array([26, 69, 223, 163])])],
  ['manifest.json', '{"v":1}'],
];

beforeEach(() => {
  vi.mocked(downloadBlob).mockClear();
  delete g.showDirectoryPicker;
});

describe('a directory write that fails mid-take (#308)', () => {
  it('keeps the whole take as a zip, manifest included, and says the folder failed', async () => {
    const { base, written } = flakyBase(1); // the first file lands, the second throws
    g.showDirectoryPicker = async () => base;
    const sink = await createRecordingSink('directory', 'take');
    expect(sink.kind).toBe('directory');
    for (const [name, data] of FILES) await sink.add(name, data); // never throws
    expect(sink.kind).toBe('zip');
    const result = await sink.close();

    expect(written).toEqual({ 'features.ndjson': '{"t":0}\n' }); // what the folder did get
    expect(result).toMatchObject({ count: FILES.length, fellBack: { from: 'directory', reason: 'the folder is gone' } });
    expect(result.label).toBe('take.zip');
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const entries = unzipSync(new Uint8Array(await vi.mocked(downloadBlob).mock.calls[0][0].arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(FILES.map(([n]) => `take/${n}`).sort());
    expect(new TextDecoder().decode(entries['take/manifest.json'])).toBe('{"v":1}');
    expect(new TextDecoder().decode(entries['take/features.ndjson'])).toBe('{"t":0}\n'); // already written, still in the zip
  });

  it('a folder that works is unchanged: no fall-back, no download', async () => {
    const { base, written } = flakyBase(99);
    g.showDirectoryPicker = async () => base;
    const sink = await createRecordingSink('directory', 'take');
    for (const [name, data] of FILES) await sink.add(name, data);
    const result = await sink.close();
    expect(result).toEqual({ label: 'take', count: FILES.length, viaPicker: true });
    expect(Object.keys(written)).toHaveLength(FILES.length);
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
