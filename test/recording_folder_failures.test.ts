/**
 * The take folder when the browser misbehaves (#391 item 3, #393 item 6, from #307):
 * the three ways the remembered folder goes wrong that `recording_folder.test.ts`
 * does not cover.
 *
 * - The folder was deleted or renamed on disk. Its permission still reads `granted`,
 *   so only `getDirectoryHandle` finds out (`NotFoundError`, or `InvalidStateError`
 *   for a handle the browser has invalidated). The folder must be forgotten and the
 *   picker offered, or every take start fails while the Trainer still names it.
 * - Asking for permission THROWS (a `SecurityError` or `NotAllowedError` once the
 *   click's user activation has lapsed). That is not the player refusing: the folder is
 *   kept and the take is simply not started, exactly like a dismissed "allow edits?"
 *   prompt. Any other exception says nothing about a later click, so it reads as a
 *   refusal: the folder is forgotten and the picker offered.
 * - IndexedDB could not keep the handle (a full disk, a private window). The folder
 *   is still the player's choice for this page: the next take uses it without asking
 *   again. (What the panel then says is `recording_folder_save_failed.test.tsx`.)
 *
 * The cases that drive the DEFAULT handle store go through the real `indexedDB` global
 * (a fake, `test/helpers/fakeIndexedDb.ts`) and import the modules fresh per test, so
 * no remembered folder leaks from one test into the next.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  acquireRecordingFolder,
  type DirPicker,
  type FolderHandleStore,
  type FsDirHandle,
} from '@/app/recording/folder';
import { installFakeIndexedDb, type FakeIndexedDb } from './helpers/fakeIndexedDb';

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

/** A writable fake folder; `files` maps `sub/name` to what was written. */
function fakeDir(name: string) {
  const files: Record<string, string> = {};
  const subs = new Set<string>();
  const dir: FsDirHandle = {
    name,
    getDirectoryHandle: async (sub, opts) => {
      if (!subs.has(sub) && !opts?.create) throw new DOMException(`no ${sub}`, 'NotFoundError');
      subs.add(sub);
      return {
        name: sub,
        getDirectoryHandle: async () => {
          throw new DOMException('not used', 'NotSupportedError');
        },
        getFileHandle: async (file) => ({
          createWritable: async () => ({
            write: async (data: Blob | string | BufferSource) => {
              files[`${sub}/${file}`] = typeof data === 'string' ? data : '<binary>';
            },
            close: async () => undefined,
          }),
        }),
      };
    },
    getFileHandle: async () => {
      throw new DOMException('not used', 'NotSupportedError');
    },
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  };
  return { dir, files, subs };
}

/** A remembered folder that no longer exists on disk: permission still `granted`. */
function vanishedDir(name: string, errorName: 'NotFoundError' | 'InvalidStateError'): FsDirHandle {
  const gone = async (): Promise<never> => {
    throw new DOMException(`${name} is gone`, errorName);
  };
  return {
    name,
    getDirectoryHandle: gone,
    getFileHandle: gone,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  };
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

/** The key `src/app/recording/idb.ts` keeps the one handle under. */
const DIR_KEY = 'dir';

const g = globalThis as unknown as { showDirectoryPicker?: unknown };
let idb: FakeIndexedDb | null = null;

afterEach(() => {
  idb?.uninstall();
  idb = null;
  delete g.showDirectoryPicker;
});

/** Fresh copies of the recording modules, over a fresh fake IndexedDB and picker. */
async function freshModules({ remembered, picker, failWrites = false }: { remembered?: FsDirHandle; picker: DirPicker | null; failWrites?: boolean }) {
  idb = installFakeIndexedDb({ failWrites });
  if (remembered) idb.data.set(DIR_KEY, remembered);
  if (picker) g.showDirectoryPicker = picker;
  vi.resetModules();
  const folder = await import('@/app/recording/folder');
  const sink = await import('@/app/recording/sink');
  return { folder, sink };
}

describe('the fake IndexedDB stands in for the browser (a control for the cases below)', () => {
  it('a chosen folder is remembered across a reload of the modules', async () => {
    const takes = fakeDir('takes');
    const { folder } = await freshModules({ picker: pickerOf(takes.dir).picker });
    expect(await folder.chooseRecordingFolder()).toEqual({ kind: 'chosen', name: 'takes' });
    vi.resetModules();
    const reloaded = await import('@/app/recording/folder');
    expect(await reloaded.rememberedRecordingFolder()).toBe('takes');
  });
});

describe('a remembered folder deleted or renamed on disk (#393 item 6)', () => {
  it.each(['NotFoundError', 'InvalidStateError'] as const)(
    'getDirectoryHandle throwing %s: the take start forgets it, offers the picker, and writes into the new folder (#393 item 6)',
    async (errorName) => {
      const fresh = fakeDir('fresh');
      const { picker, calls } = pickerOf(fresh.dir);
      const { folder, sink } = await freshModules({ remembered: vanishedDir('gone', errorName), picker });
      const take = await sink.createRecordingSink('directory', 'take');
      expect(calls).toHaveLength(1);
      await take.add('manifest.json', '{}');
      expect(await take.close()).toMatchObject({ label: 'take', count: 1 });
      expect(fresh.files['take/manifest.json']).toBe('{}');
      expect(await folder.rememberedRecordingFolder()).toBe('fresh');
    },
  );

  it('when the offered picker is dismissed, the vanished folder is still forgotten and the take is cancelled (#393 item 6)', async () => {
    const { picker, calls } = pickerOf(null);
    const { folder, sink } = await freshModules({ remembered: vanishedDir('gone', 'NotFoundError'), picker });
    await expect(sink.createRecordingSink('directory', 'take')).rejects.toBeInstanceOf(sink.SinkCancelled);
    expect(calls).toHaveLength(1);
    expect(await folder.rememberedRecordingFolder()).toBeNull();
  });
});

describe('asking for permission throws (#393 item 6)', () => {
  const throwing = (where: 'query' | 'request', errorName = 'SecurityError'): FsDirHandle => {
    const securityError = async (): Promise<never> => {
      throw new DOMException(`permission check threw ${errorName}`, errorName);
    };
    return {
      ...fakeDir('kept').dir,
      queryPermission: where === 'query' ? securityError : async () => 'prompt',
      requestPermission: securityError,
    };
  };

  it('requestPermission throwing SecurityError: the folder is kept, the picker is not opened, the take does not start (#393 item 6)', async () => {
    const store = memoryStore(throwing('request'));
    const { picker, calls } = pickerOf(fakeDir('fresh').dir);
    expect(await acquireRecordingFolder({ store, picker })).toBeNull();
    expect(store.handle?.name).toBe('kept');
    expect(calls).toHaveLength(0);
  });

  it('queryPermission throwing SecurityError: the folder is kept too (#393 item 6)', async () => {
    const store = memoryStore(throwing('query'));
    const { picker, calls } = pickerOf(fakeDir('fresh').dir);
    expect(await acquireRecordingFolder({ store, picker })).toBeNull();
    expect(store.handle?.name).toBe('kept');
    expect(calls).toHaveLength(0);
  });

  it('requestPermission throwing NotAllowedError (the other activation refusal): the folder is kept', async () => {
    const store = memoryStore(throwing('request', 'NotAllowedError'));
    const { picker, calls } = pickerOf(fakeDir('fresh').dir);
    expect(await acquireRecordingFolder({ store, picker })).toBeNull();
    expect(store.handle?.name).toBe('kept');
    expect(calls).toHaveLength(0);
  });

  it.each(['query', 'request'] as const)(
    'a %sPermission exception that is not an activation refusal reads as denied: the folder is forgotten and the picker offered',
    async (where) => {
      const store = memoryStore(throwing(where, 'InvalidStateError'));
      const { picker, calls } = pickerOf(fakeDir('fresh').dir);
      expect((await acquireRecordingFolder({ store, picker }))?.name).toBe('fresh');
      expect(calls).toHaveLength(1);
      expect(store.handle?.name).toBe('fresh');
    },
  );
});

describe('IndexedDB could not keep the chosen folder (#393 item 6)', () => {
  it('the next take this session uses the chosen folder without asking again (#393 item 6)', async () => {
    const takes = fakeDir('takes');
    const { picker, calls } = pickerOf(takes.dir);
    const { folder } = await freshModules({ picker, failWrites: true });
    expect(await folder.chooseRecordingFolder()).toMatchObject({ kind: 'chosen', name: 'takes' });
    expect(idb?.data.has(DIR_KEY)).toBe(false);
    const handle = await folder.acquireRecordingFolder();
    expect(handle?.name).toBe('takes');
    expect(calls).toHaveLength(1);
  });
});
