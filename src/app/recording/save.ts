/**
 * saveBlob — save a recording, preferring the File System Access API
 * (`showSaveFilePicker`, Chromium) so the player chooses where it lands, and
 * falling back to a normal anchor download (→ the browser's Downloads folder)
 * everywhere else. Returns the filename actually used, or `null` if the player
 * cancelled the picker. The web APIs expose the chosen filename but never a true
 * absolute OS path, so callers should surface the name, not a path.
 */
import { downloadBlob } from '../recorder';

export interface SaveResult {
  filename: string;
  /** True if saved via the file picker; false if it fell back to a download. */
  viaPicker: boolean;
}

export interface SaveOptions {
  /**
   * Offer the native "Save As" picker when supported. Pass `false` to force a
   * direct download — used for all but the first file when saving several
   * formats at once, so the player isn't hit with one modal dialog per format.
   */
  allowPicker?: boolean;
}

interface SaveFilePicker {
  showSaveFilePicker?: (opts: { suggestedName?: string }) => Promise<{
    name?: string;
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}

export async function saveBlob(
  blob: Blob,
  suggestedName: string,
  opts: SaveOptions = {},
): Promise<SaveResult | null> {
  const { allowPicker = true } = opts;
  const picker = (globalThis as unknown as SaveFilePicker).showSaveFilePicker;
  if (allowPicker && typeof picker === 'function') {
    let handle: Awaited<ReturnType<NonNullable<SaveFilePicker['showSaveFilePicker']>>> | null = null;
    try {
      handle = await picker({ suggestedName });
    } catch (e) {
      // User dismissed the picker: not an error; report cancellation. Only the picker's own
      // AbortError means that: a write or close the browser aborts is a failed save, below.
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      console.warn('[thoremin] file picker failed; falling back to download', e);
    }
    if (handle) {
      let writable: Awaited<ReturnType<typeof handle.createWritable>> | null = null;
      try {
        writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { filename: handle.name ?? suggestedName, viaPicker: true };
      } catch (e) {
        // Drop the half-written file (Chromium's swap file) rather than leave it to the collector.
        await (writable as { abort?: () => Promise<void> } | null)?.abort?.().catch(() => {});
        // Permission revoked, disk full, the stream torn down: log it, consistent with the
        // rest of the app's error handling, then fall back to a plain download so the take
        // is never lost.
        console.warn('[thoremin] file picker save failed; falling back to download', e);
      }
    }
  }
  downloadBlob(blob, suggestedName);
  return { filename: suggestedName, viaPicker: false };
}
