/**
 * Recording-session schema (#88): defaults, forward-compat (`.default` on every
 * field), and the safeParse-with-fallback the persistence layer relies on.
 */
import { describe, it, expect } from 'vitest';
import {
  RecordingSessionSchema,
  DEFAULT_RECORDING_SESSION,
  parseSession,
  hasAnyStream,
} from '@/app/recording/schema';

describe('DEFAULT_RECORDING_SESSION', () => {
  it('is audio-only, downloads, 30fps, webm', () => {
    expect(DEFAULT_RECORDING_SESSION.location).toBe('downloads');
    expect(DEFAULT_RECORDING_SESSION.fps).toBe(30);
    expect(DEFAULT_RECORDING_SESSION.formats).toEqual(['webm']);
    expect(DEFAULT_RECORDING_SESSION.streams.audio).toBe(true);
    expect(DEFAULT_RECORDING_SESSION.streams.overlayVideo).toBe(false);
    expect(DEFAULT_RECORDING_SESSION.singleFileWhenAlone).toBe(false);
  });
});

describe('parseSession', () => {
  it('heals null/garbage to the default', () => {
    expect(parseSession(null)).toEqual(DEFAULT_RECORDING_SESSION);
    expect(parseSession('nope')).toEqual(DEFAULT_RECORDING_SESSION);
  });

  it('fills missing stream fields with their defaults (partial blob)', () => {
    const s = parseSession({ streams: { overlayVideo: true } });
    expect(s.streams.overlayVideo).toBe(true);
    expect(s.streams.audio).toBe(true); // default preserved
    expect(s.streams.featureEdges).toEqual([]);
  });

  it('keeps a valid overwritten name + location', () => {
    const s = parseSession({ name: 'my-take', location: 'directory' });
    expect(s.name).toBe('my-take');
    expect(s.location).toBe('directory');
  });
});

describe('schema forward-compat', () => {
  it('an empty object parses to the full default (every field defaulted)', () => {
    expect(RecordingSessionSchema.parse({})).toEqual(DEFAULT_RECORDING_SESSION);
  });
});

describe('hasAnyStream', () => {
  it('is true for the default (audio on) and false when everything is off', () => {
    expect(hasAnyStream(DEFAULT_RECORDING_SESSION.streams)).toBe(true);
    expect(
      hasAnyStream({
        audio: false,
        overlayVideo: false,
        pureVideo: false,
        pureVideoAudio: false,
        overlayAlpha: false,
        features: false,
        featureEdges: [],
      }),
    ).toBe(false);
  });
});
