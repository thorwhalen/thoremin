/**
 * The recording folder (#257): the one mechanism the trainer's control and the
 * directory sink share. Feature-detected (no picker: unsupported, never a throw),
 * a dismissed picker is a cancellation that remembers nothing, a choice is
 * remembered, and the sink reuses a remembered folder whose permission holds, asks
 * again when it is refused, and reports a cancel as `SinkCancelled`.
 */
import { describe, it, expect } from 'vitest';
import {
  acquireRecordingFolder,
  chooseRecordingFolder,
  rememberedRecordingFolder,
  type DirPicker,
  type FolderHandleStore,
  type FsDirHandle,
} from '@/app/recording/folder';
import { createRecordingSink, SinkCancelled } from '@/app/recording/sink';

function memoryStore(initial: FsDirHandle | null = null): FolderHandleStore & { handle: FsDirHandle | null } {
  const store = {
    handle: initial,
    load: async () => store.handle,
    save: async (h: FsDirHandle) => {
      store.handle = h;
    },
    clear: async () => {
      store.handle = null;
    },
  };
  return store;
}

/** A fake directory: files written into it are kept by name; permission is scripted. */
function fakeDir(name: string, permission: PermissionState = 'granted') {
  const files: Record<string, (Blob | string)[]> = {};
  const dir: FsDirHandle = {
    name,
    getDirectoryHandle: async (sub) => fakeDir(`${name}/${sub}`, permission).dir,
    getFileHandle: async (file) => ({
      createWritable: async () => ({
        write: async (data: Blob | string | BufferSource) => {
          (files[file] ??= []).push(data as Blob | string);
        },
        close: async () => undefined,
      }),
    }),
    queryPermission: async () => permission,
    requestPermission: async () => permission,
  };
  return { dir, files };
}

const pickerOf = (handle: FsDirHandle | null) => {
  const calls: unknown[] = [];
  const picker: DirPicker = async (opts) => {
    calls.push(opts);
    if (!handle) throw new DOMException('dismissed', 'AbortError');
    return handle;
  };
  return { picker, calls };
};

describe('chooseRecordingFolder (the control)', () => {
  it('reports unsupported where there is no picker, and remembers nothing', async () => {
    const store = memoryStore();
    expect(await chooseRecordingFolder({ store, picker: null })).toEqual({ kind: 'unsupported' });
    expect(store.handle).toBeNull();
  });

  it('remembers the chosen folder and names it', async () => {
    const store = memoryStore();
    const { picker, calls } = pickerOf(fakeDir('takes').dir);
    expect(await chooseRecordingFolder({ store, picker })).toEqual({ kind: 'chosen', name: 'takes' });
    expect(store.handle?.name).toBe('takes');
    expect(await rememberedRecordingFolder({ store })).toBe('takes');
    // Opened for writing, so the take can be written without a second prompt.
    expect(calls[0]).toMatchObject({ mode: 'readwrite' });
  });

  it('a dismissed picker is a cancellation that leaves the remembered folder as it was', async () => {
    const store = memoryStore(fakeDir('old').dir);
    const { picker } = pickerOf(null);
    expect(await chooseRecordingFolder({ store, picker })).toEqual({ kind: 'cancelled' });
    expect(await rememberedRecordingFolder({ store })).toBe('old');
  });

  it('any other picker failure propagates (it is not a cancel)', async () => {
    const store = memoryStore();
    const picker: DirPicker = async () => {
      throw new DOMException('no gesture', 'SecurityError');
    };
    await expect(chooseRecordingFolder({ store, picker })).rejects.toThrow('no gesture');
  });
});

describe('acquireRecordingFolder (the sink)', () => {
  it('reuses the remembered folder without prompting while its permission holds', async () => {
    const store = memoryStore(fakeDir('remembered').dir);
    const { picker, calls } = pickerOf(fakeDir('fresh').dir);
    const handle = await acquireRecordingFolder({ store, picker });
    expect(handle?.name).toBe('remembered');
    expect(calls).toHaveLength(0);
  });

  it('forgets a remembered folder whose permission is refused and asks for a new one', async () => {
    const store = memoryStore(fakeDir('refused', 'denied').dir);
    const { picker, calls } = pickerOf(fakeDir('fresh').dir);
    const handle = await acquireRecordingFolder({ store, picker });
    expect(handle?.name).toBe('fresh');
    expect(calls).toHaveLength(1);
    expect(store.handle?.name).toBe('fresh');
  });

  it('is null with no picker, and null (remembering nothing) when the picker is dismissed', async () => {
    expect(await acquireRecordingFolder({ store: memoryStore(), picker: null })).toBeNull();
    const store = memoryStore();
    expect(await acquireRecordingFolder({ store, picker: pickerOf(null).picker })).toBeNull();
    expect(store.handle).toBeNull();
  });
});

describe('the directory sink over the shared mechanism', () => {
  const withPicker = async (picker: unknown, run: () => Promise<void>) => {
    const g = globalThis as unknown as { showDirectoryPicker?: unknown };
    const before = g.showDirectoryPicker;
    g.showDirectoryPicker = picker;
    try {
      await run();
    } finally {
      if (before === undefined) delete g.showDirectoryPicker;
      else g.showDirectoryPicker = before;
    }
  };

  it('reports a dismissed picker as SinkCancelled so the take aborts rather than recording elsewhere', async () => {
    await withPicker(pickerOf(null).picker, async () => {
      await expect(createRecordingSink('directory', 'take-1')).rejects.toBeInstanceOf(SinkCancelled);
    });
  });

  it('writes the take into a subfolder of the chosen folder', async () => {
    const base = fakeDir('takes');
    await withPicker(pickerOf(base.dir).picker, async () => {
      const sink = await createRecordingSink('directory', 'take-1');
      expect(sink.kind).toBe('directory');
      await sink.add('manifest.json', '{}');
      const result = await sink.close();
      expect(result).toMatchObject({ label: 'take-1', count: 1, viaPicker: true });
    });
  });
});
