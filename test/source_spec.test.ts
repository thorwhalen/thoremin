/**
 * Tests for parseSourceSpec — the startup source selection (Stream Applier M-A).
 * The live acquisition (getUserMedia vs <video src>) is browser-only; this
 * covers the pure URL→SourceSpec parsing that decides which path runs.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseSourceSpec, DEFAULT_SOURCE } from '../src/app/sourceSpec';

describe('parseSourceSpec', () => {
  it('defaults to the camera with no params', () => {
    expect(parseSourceSpec('')).toEqual({ kind: 'camera' });
    expect(parseSourceSpec('?engine=dag')).toEqual(DEFAULT_SOURCE);
  });

  it('selects a video file source from ?source=video&video=<url>', () => {
    expect(parseSourceSpec('?source=video&video=/media/demo.mp4')).toEqual({
      kind: 'video',
      url: '/media/demo.mp4',
    });
  });

  it('accepts the clip= alias for the url', () => {
    expect(parseSourceSpec('?source=video&clip=/clips/a.webm')).toEqual({
      kind: 'video',
      url: '/clips/a.webm',
    });
    // video= wins when both are present.
    expect(parseSourceSpec('?source=video&video=/v.mp4&clip=/c.mp4')).toEqual({
      kind: 'video',
      url: '/v.mp4',
    });
  });

  it('preserves an absolute/remote url verbatim', () => {
    expect(parseSourceSpec('?source=video&video=https://cdn.example.com/a%20b.mp4')).toEqual({
      kind: 'video',
      url: 'https://cdn.example.com/a b.mp4',
    });
  });

  it('falls back to the camera (with a warning) when source=video has no url', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseSourceSpec('?source=video')).toEqual({ kind: 'camera' });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('treats a blank/whitespace url as missing (camera fallback)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseSourceSpec('?source=video&video=')).toEqual({ kind: 'camera' });
    expect(parseSourceSpec('?source=video&video=%20%20')).toEqual({ kind: 'camera' });
    warn.mockRestore();
  });

  it('trims surrounding whitespace from a url', () => {
    expect(parseSourceSpec('?source=video&video=%20/clip.mp4%20')).toEqual({
      kind: 'video',
      url: '/clip.mp4',
    });
  });

  it('documents that an unencoded & truncates the url (URLSearchParams semantics)', () => {
    // A raw "&" starts a new param, so the url must be percent-encoded; this
    // pins the contract so callers know to encode.
    expect(parseSourceSpec('?source=video&video=/a.mp4&t=1')).toEqual({
      kind: 'video',
      url: '/a.mp4',
    });
  });

  it('ignores an unknown source value', () => {
    expect(parseSourceSpec('?source=midi')).toEqual({ kind: 'camera' });
  });

  it('tolerates a missing leading ?', () => {
    expect(parseSourceSpec('source=video&video=/x.mp4')).toEqual({ kind: 'video', url: '/x.mp4' });
  });
});
