/**
 * Adversarial audit of the take's save path (2026-10-20 review lane, #257): one try covered
 * the picker AND the write, and any `AbortError` read as "the player cancelled", so a write
 * or close the browser aborted (its stream torn down, a lost activation) lost the take: no
 * file, no download, the sink told "cancelled". Only the picker's own AbortError is a cancel.
 */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ downloads: [] as string[] }));
vi.mock('@/app/recorder', () => ({ downloadBlob: (_b: Blob, name: string) => void h.downloads.push(name) }));
import { saveBlob } from '@/app/recording/save';

const abort = () => new DOMException('aborted', 'AbortError');

describe('saveBlob under an AbortError', () => {
  it('from the picker: a cancel, nothing downloaded', async () => {
    h.downloads.length = 0;
    vi.stubGlobal('showSaveFilePicker', async () => {
      throw abort();
    });
    try {
      expect(await saveBlob(new Blob(['x']), 'take.zip')).toBeNull();
      expect(h.downloads).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('from the write: not a cancel, the take is downloaded instead', async () => {
    h.downloads.length = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const aborted = vi.fn(async () => {});
    vi.stubGlobal('showSaveFilePicker', async () => ({
      name: 'take.zip',
      createWritable: async () => ({
        write: async () => {
          throw abort();
        },
        close: async () => {},
        abort: aborted,
      }),
    }));
    try {
      expect(await saveBlob(new Blob(['x']), 'take.zip')).toEqual({ filename: 'take.zip', viaPicker: false });
      expect(h.downloads).toEqual(['take.zip']);
      expect(aborted).toHaveBeenCalledTimes(1); // the half-written file is dropped
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
    }
  });
});
