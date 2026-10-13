/**
 * The zip and per-file recording sinks write every file they are given (#391 item 3).
 * The directory sink is covered in `recording_folder.test.ts`; these are the two
 * backends a browser without a folder picker falls back to, and the only record of a
 * take there, so a file lost between `add` and `close` is a take lost. Each test adds
 * a mix of text and binary files and checks, file by file, what reached the browser's
 * download (`downloadBlob`, mocked) or Save-As picker, and the count `close` reports.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unzipSync } from 'fflate';

vi.mock('@/app/recorder', () => ({ downloadBlob: vi.fn() }));
import { downloadBlob } from '@/app/recorder';
import { createRecordingSink } from '@/app/recording/sink';

/** What a take writes: text (the manifest, NDJSON streams) and binary (audio, video). */
const TAKE: { name: string; data: Blob | string; bytes: Uint8Array }[] = [
  { name: 'manifest.json', data: '{"v":1}', bytes: new TextEncoder().encode('{"v":1}') },
  { name: 'features.ndjson', data: '{"t":0}\n{"t":1}\n', bytes: new TextEncoder().encode('{"t":0}\n{"t":1}\n') },
  { name: 'audio.wav', data: new Blob([new Uint8Array([82, 73, 70, 70, 0, 255])]), bytes: new Uint8Array([82, 73, 70, 70, 0, 255]) },
  { name: 'video.webm', data: new Blob([new Uint8Array([26, 69, 223, 163])]), bytes: new Uint8Array([26, 69, 223, 163]) },
];

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

const g = globalThis as unknown as { showSaveFilePicker?: unknown };

beforeEach(() => {
  vi.mocked(downloadBlob).mockClear();
  delete g.showSaveFilePicker;
});
afterEach(() => {
  delete g.showSaveFilePicker;
});

describe('the zip sink', () => {
  it('puts every added file, byte for byte, under the take folder in one download, and counts them', async () => {
    const sink = await createRecordingSink('zip', 'take-1');
    expect(sink).toMatchObject({ kind: 'zip', folderName: 'take-1' });
    for (const f of TAKE) await sink.add(f.name, f.data);
    const result = await sink.close();
    expect(result).toEqual({ label: 'take-1.zip', count: TAKE.length, viaPicker: false, cancelled: false });

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
    expect(filename).toBe('take-1.zip');
    const entries = unzipSync(await bytesOf(blob));
    expect(Object.keys(entries).sort()).toEqual(TAKE.map((f) => `take-1/${f.name}`).sort());
    for (const f of TAKE) expect(entries[`take-1/${f.name}`]).toEqual(f.bytes);
  });

  it('an empty take is still one (empty) zip with a count of 0', async () => {
    const sink = await createRecordingSink('zip', 'empty');
    expect(await sink.close()).toMatchObject({ count: 0, cancelled: false });
    expect(Object.keys(unzipSync(await bytesOf(vi.mocked(downloadBlob).mock.calls[0][0])))).toEqual([]);
  });
});

describe('the per-file sink', () => {
  it('downloads every added file under its own name, byte for byte, and counts them', async () => {
    const sink = await createRecordingSink('perFile', 'take-2');
    expect(sink).toMatchObject({ kind: 'perFile', folderName: 'take-2' });
    for (const f of TAKE) await sink.add(f.name, f.data);
    const result = await sink.close();
    expect(result).toEqual({ label: `take-2 (${TAKE.length} files)`, count: TAKE.length, viaPicker: false });

    const calls = vi.mocked(downloadBlob).mock.calls;
    expect(calls.map(([, name]) => name)).toEqual(TAKE.map((f) => f.name));
    for (const [i, f] of TAKE.entries()) expect(await bytesOf(calls[i][0])).toEqual(f.bytes);
  });

  it('offers the Save-As picker for the first file only, and still writes all of them', async () => {
    const picked: { name: string; bytes: Uint8Array }[] = [];
    g.showSaveFilePicker = async ({ suggestedName }: { suggestedName?: string }) => ({
      name: suggestedName,
      createWritable: async () => ({
        write: async (blob: Blob) => {
          picked.push({ name: suggestedName ?? '', bytes: await bytesOf(blob) });
        },
        close: async () => undefined,
      }),
    });
    const sink = await createRecordingSink('perFile', 'take-3');
    for (const f of TAKE) await sink.add(f.name, f.data);
    const result = await sink.close();
    expect(result).toMatchObject({ count: TAKE.length, viaPicker: true });

    expect(picked).toEqual([{ name: TAKE[0].name, bytes: TAKE[0].bytes }]);
    const downloaded = vi.mocked(downloadBlob).mock.calls;
    expect(downloaded.map(([, name]) => name)).toEqual(TAKE.slice(1).map((f) => f.name));
    for (const [i, f] of TAKE.slice(1).entries()) expect(await bytesOf(downloaded[i][0])).toEqual(f.bytes);
  });
});
