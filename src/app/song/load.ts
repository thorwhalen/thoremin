/**
 * Load a song file in the browser (#186 PR G): decode it once for analysis, track its
 * beats, and hand back the {@link SongHandle} the hot store carries and the `song-player`
 * node consumes.
 *
 * Decoding uses a throwaway `OfflineAudioContext` at the tracker's rate (22.05 kHz), so
 * the analysis needs neither the instrument's `AudioContext` (created on the player's
 * first tap) nor a codec: every current browser decodes MP3, AAC, WAV, OGG and FLAC
 * natively (research map §5.1). Playback does not use these samples: the stretcher reads
 * the file itself through an object URL (Signalsmith decodes it again at the context's
 * rate, the media element streams it), so they are dropped after tracking, before playback
 * holds its own, and never reach the store.
 *
 * The tracker runs inline, once per file: a four-minute song is a few hundred
 * milliseconds. A Worker is the next step if a longer file ever needs one.
 */
import { toMono, trackSongGrid } from '@thoremin/ictus';
import type { SongHandle } from '@/nodes/output/song_player.schema';

/** The analysis rate: `decodeAudioData` resamples to it, which is the downsample the
 *  tracker wants. */
export const ANALYSIS_SAMPLE_RATE = 22050;

export interface DecodedAudio {
  channels: Float32Array[];
  durationS: number;
}

export interface AnalyzeOptions {
  /** Decode the bytes (injectable: Node has no `OfflineAudioContext`). */
  decode?: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
  /** Make the URL the stretcher streams (injectable for the same reason). */
  makeUrl?: (file: Blob) => string;
}

let nextId = 1;

/** Decode `file`, track its beats and return its handle. Rejects when it cannot be decoded. */
export async function analyzeSong(file: Blob & { name?: string }, opts: AnalyzeOptions = {}): Promise<SongHandle> {
  const decode = opts.decode ?? decodeOffline;
  const { channels, durationS } = await decode(await file.arrayBuffer());
  const grid = trackSongGrid(toMono(channels), { sampleRate: ANALYSIS_SAMPLE_RATE });
  const url = (opts.makeUrl ?? ((b: Blob) => URL.createObjectURL(b)))(file);
  return { id: `song-${nextId++}`, name: file.name || 'song', url, durationS, grid };
}

async function decodeOffline(bytes: ArrayBuffer): Promise<DecodedAudio> {
  const ctx = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
  const buffer = await ctx.decodeAudioData(bytes);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return { channels, durationS: buffer.duration };
}
