/**
 * Load a song file in the browser (#186 PR G): decode it once for analysis at the
 * tracker's rate, run the beat tracker, and hand back a {@link SongHandle} — the
 * transient object the hot store carries and the `song-player` node consumes.
 *
 * Decoding uses a throwaway `OfflineAudioContext` at 22.05 kHz mono, so the
 * analysis needs neither the instrument's `AudioContext` (created on a user
 * gesture by the host) nor a codec: every current browser decodes MP3, AAC, WAV,
 * OGG and FLAC natively. Playback does not use the decoded buffer at all — the
 * media-element stretcher streams the file itself — so the buffer is dropped
 * after tracking and never persisted (a decoded song is tens of megabytes; it
 * must never reach zustand's `persist`).
 *
 * The tracker runs inline: on a 4-minute song it is well under a second, once, at
 * load time. A Worker is the obvious next step if a longer file ever needs it.
 */
import { trackBeats, toMono, type SongGrid } from './beatTrack';

/** The song as the instrument sees it: a stable object per loaded file. */
export interface SongHandle {
  /** A fresh id per load, so a consumer can detect a new song by identity or id. */
  id: string;
  name: string;
  /** An object URL the stretcher streams; revoked when the song is unloaded. */
  url: string;
  durationS: number;
  grid: SongGrid;
}

export const ANALYSIS_SAMPLE_RATE = 22050;

let nextId = 1;

/** Decode `file` and track its beats. `decode` is injectable for tests (no DOM there). */
export async function analyzeSong(
  file: Blob & { name?: string },
  opts: { decode?: (bytes: ArrayBuffer) => Promise<{ channels: Float32Array[]; durationS: number }>; url?: string } = {},
): Promise<SongHandle> {
  const bytes = await file.arrayBuffer();
  const decode = opts.decode ?? decodeWithOfflineContext;
  const { channels, durationS } = await decode(bytes);
  const mono = toMono(channels);
  const grid = trackBeats(mono, { sampleRate: ANALYSIS_SAMPLE_RATE });
  const url = opts.url ?? URL.createObjectURL(file);
  return { id: `song-${nextId++}`, name: file.name ?? 'song', url, durationS, grid };
}

/** Decode with a throwaway offline context at the analysis rate (browser-only). */
async function decodeWithOfflineContext(bytes: ArrayBuffer): Promise<{ channels: Float32Array[]; durationS: number }> {
  // Length 1: we only use the context for decoding. decodeAudioData resamples to the
  // context's rate, which is exactly the downsample the tracker wants.
  const ctx = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
  const buffer = await ctx.decodeAudioData(bytes);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return { channels, durationS: buffer.duration };
}

/** Release a song's object URL (the store calls this when a song is replaced/unloaded). */
export function releaseSong(song: SongHandle | null | undefined): void {
  if (song?.url.startsWith('blob:')) URL.revokeObjectURL(song.url);
}
