/**
 * Unit tests for the pure helpers of the performance recorder (codec choice,
 * extension, filename). The PerformanceRecorder class itself uses browser-only
 * Web Audio + MediaRecorder APIs and is exercised in the browser.
 */
import { describe, it, expect } from 'vitest';
import { pickMimeType, extForMime, recordingFilename } from '@/app/recorder';

describe('recorder helpers', () => {
  it('picks the first supported codec, preferring opus webm', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickMimeType((m) => m === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMimeType(() => false)).toBe('audio/webm'); // safe fallback
  });

  it('maps mime types to file extensions', () => {
    expect(extForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extForMime('audio/webm')).toBe('webm');
    expect(extForMime('audio/ogg;codecs=opus')).toBe('ogg');
    expect(extForMime('audio/mp4')).toBe('m4a');
  });

  it('builds a filesystem-safe timestamped filename', () => {
    const name = recordingFilename('2026-06-22T07:30:00.123Z', 'webm');
    expect(name).toBe('thoremin-2026-06-22T07-30-00-123.webm');
    expect(name).not.toContain(':'); // colons are illegal on some filesystems
    expect(name.slice(0, -'.webm'.length)).not.toContain('.'); // only the extension dot
  });
});
