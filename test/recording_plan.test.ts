/**
 * Recording plan (#88): the pure file-planning that encodes the naming scheme
 * (§3) — secondary exts, always-a-folder + manifest, and the single-file escape
 * hatch. This is the contract every sink writes against, so it is tested hard.
 */
import { describe, it, expect } from 'vitest';
import { planRecording, videoExtForMime } from '@/app/recording/plan';
import { RecordingSessionSchema, type RecordingSession } from '@/app/recording/schema';

const STEM = 'demo-theremin-2026-07-05T14-30-12';
const AUDIO_MIME = 'audio/webm;codecs=opus';
const VIDEO_MIME = 'video/webm;codecs=vp9,opus';

/** Build a session from a partial input blob; the schema fills the rest with
 * defaults (so a test can name just the stream flags it cares about). */
function session(overrides: Record<string, unknown> = {}): RecordingSession {
  return RecordingSessionSchema.parse(overrides);
}

const plan = (s: RecordingSession) =>
  planRecording({ session: s, stem: STEM, audioMime: AUDIO_MIME, videoMime: VIDEO_MIME });

const names = (s: RecordingSession) => plan(s).files.map((f) => f.name);

describe('videoExtForMime', () => {
  it('maps mp4 and defaults to webm', () => {
    expect(videoExtForMime('video/mp4')).toBe('mp4');
    expect(videoExtForMime('video/webm;codecs=vp9,opus')).toBe('webm');
  });
});

describe('planRecording — folder mode (default)', () => {
  it('audio-only take is a folder with the audio file + a manifest', () => {
    const p = plan(session());
    expect(p.useFolder).toBe(true);
    expect(p.folderName).toBe(STEM);
    expect(p.files.map((f) => f.name)).toEqual([`${STEM}.webm`, `${STEM}.manifest.json`]);
  });

  it('each selected format adds an audio file (bare primary ext)', () => {
    expect(names(session({ formats: ['webm', 'wav'] }))).toEqual([
      `${STEM}.webm`,
      `${STEM}.wav`,
      `${STEM}.manifest.json`,
    ]);
  });

  it('video streams carry role secondary exts; the manifest is always last', () => {
    const p = plan(
      session({
        streams: { overlayVideo: true, pureVideo: true, overlayAlpha: true, features: true },
      }),
    );
    expect(p.files.map((f) => f.name)).toEqual([
      `${STEM}.overlay.webm`,
      `${STEM}.camera.webm`,
      `${STEM}.alpha.webm`,
      `${STEM}.webm`, // audio (still on, default)
      `${STEM}.features.jsonl`,
      `${STEM}.manifest.json`,
    ]);
    // Kinds are carried for the manifest builder.
    expect(p.files.find((f) => f.role === 'overlay')?.kind).toBe('overlayVideo');
    expect(p.files.find((f) => f.role === 'camera')?.kind).toBe('pureVideo');
    expect(p.files.find((f) => f.role === 'alpha')?.kind).toBe('overlayAlpha');
  });

  it('honors an mp4 video mime in the secondary-ext names', () => {
    const p = planRecording({
      session: session({ streams: { overlayVideo: true, audio: false } }),
      stem: STEM,
      audioMime: AUDIO_MIME,
      videoMime: 'video/mp4',
    });
    expect(p.files.map((f) => f.name)).toEqual([`${STEM}.overlay.mp4`, `${STEM}.manifest.json`]);
  });

  it('drops an unknown format id but still produces the native webm', () => {
    expect(names(session({ formats: ['bogus'] }))).toEqual([
      `${STEM}.webm`,
      `${STEM}.manifest.json`,
    ]);
  });
});

describe('planRecording — single-file escape hatch', () => {
  it('one media stream + opt-in ⇒ bare file, no folder, no manifest', () => {
    const p = plan(session({ singleFileWhenAlone: true }));
    expect(p.useFolder).toBe(false);
    expect(p.files.map((f) => f.name)).toEqual([`${STEM}.webm`]);
  });

  it('a lone overlay video saves bare (role omitted, no collision)', () => {
    const p = plan(
      session({ singleFileWhenAlone: true, streams: { audio: false, overlayVideo: true } }),
    );
    expect(p.useFolder).toBe(false);
    expect(p.files.map((f) => f.name)).toEqual([`${STEM}.webm`]);
  });

  it('is NOT eligible when a feature stream is also selected', () => {
    const p = plan(session({ singleFileWhenAlone: true, streams: { features: true } }));
    expect(p.useFolder).toBe(true);
    expect(p.files.some((f) => f.kind === 'manifest')).toBe(true);
  });

  it('is NOT eligible with two audio formats (two files need a folder)', () => {
    const p = plan(session({ singleFileWhenAlone: true, formats: ['webm', 'wav'] }));
    expect(p.useFolder).toBe(true);
  });

  it('is NOT eligible with two media streams', () => {
    const p = plan(
      session({ singleFileWhenAlone: true, streams: { audio: true, overlayVideo: true } }),
    );
    expect(p.useFolder).toBe(true);
  });
});

describe('planRecording — live-tagging stream (#92)', () => {
  const planT = (s: RecordingSession, includeTags: boolean) =>
    planRecording({ session: s, stem: STEM, audioMime: AUDIO_MIME, videoMime: VIDEO_MIME, includeTags });

  it('adds a `.tags.jsonl` stream (before the manifest) when tagging is active', () => {
    const p = planT(session(), true);
    const tags = p.files.find((f) => f.kind === 'tags');
    expect(tags?.name).toBe(`${STEM}.tags.jsonl`);
    expect(tags).toMatchObject({ role: 'tags', ext: 'jsonl' });
    // ordering: tags sits right before the always-last manifest
    const kinds = p.files.map((f) => f.kind);
    expect(kinds.indexOf('tags')).toBe(kinds.indexOf('manifest') - 1);
  });

  it('omits the tags stream when tagging is inactive', () => {
    expect(planT(session(), false).files.some((f) => f.kind === 'tags')).toBe(false);
  });

  it('forces folder mode even for an otherwise single-file-eligible take', () => {
    const p = planT(session({ singleFileWhenAlone: true, streams: { audio: true } }), true);
    expect(p.useFolder).toBe(true);
    expect(p.files.some((f) => f.kind === 'tags')).toBe(true);
    expect(p.files.some((f) => f.kind === 'manifest')).toBe(true);
  });
});
