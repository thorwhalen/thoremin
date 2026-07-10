/**
 * Recording manifest (#88): the per-folder alignment SSOT. Pure build + serialize.
 */
import { describe, it, expect } from 'vitest';
import {
  buildManifest,
  serializeManifest,
  RECORDING_MANIFEST_VERSION,
  type RecordingStreamEntry,
} from '@/app/recording/manifest';

const streams: RecordingStreamEntry[] = [
  { file: 's.overlay.webm', kind: 'overlayVideo', mime: 'video/webm', fps: 30 },
  { file: 's.webm', kind: 'audio', mime: 'audio/webm;codecs=opus' },
  { file: 's.features.jsonl', kind: 'features' },
];

describe('buildManifest', () => {
  it('captures the version, clock origin, instrument, stem, and streams', () => {
    const m = buildManifest({
      startedAt: '2026-07-05T14:30:12.000Z',
      t0: 12.5,
      stem: 's',
      instrument: 'theremin',
      streams,
    });
    expect(m.version).toBe(RECORDING_MANIFEST_VERSION);
    expect(m.startedAt).toBe('2026-07-05T14:30:12.000Z');
    expect(m.t0).toBe(12.5);
    expect(m.instrument).toBe('theremin');
    expect(m.stem).toBe('s');
    expect(m.streams).toHaveLength(3);
  });
});

describe('serializeManifest', () => {
  it('round-trips through JSON with a trailing newline', () => {
    const m = buildManifest({ startedAt: 'x', t0: 0, stem: 's', streams });
    const text = serializeManifest(m);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(m);
  });
});
