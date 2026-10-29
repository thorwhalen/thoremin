/**
 * Load an audio-games fixture (`test/fixtures/audio_games_*`): the recording (mono, through the
 * trainer-take WAV parser) and its annotations: a frame-level f0 track and the notes, as the
 * fixture's README describes them.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseWav, type Wav } from '../../scripts/cue/lib_pair_take';

export interface AnnotatedNote {
  start: number;
  hz: number;
  duration: number;
}

export interface AudioFixture {
  wav: Wav;
  /** Frame-level reference f0 (Hz, 0 = unvoiced), when the fixture has one. */
  f0: { t: number; hz: number }[];
  notes: AnnotatedNote[];
}

const csvRows = (path: string): number[][] =>
  existsSync(path)
    ? readFileSync(path, 'utf8').trim().split('\n').slice(1).map((line) => line.split(',').map(Number))
    : [];

export function loadAudioFixture(name: string): AudioFixture {
  const dir = join('test', 'fixtures', name);
  return {
    wav: parseWav(new Uint8Array(readFileSync(join(dir, 'audio.wav')))),
    f0: csvRows(join(dir, 'f0.csv')).map(([t, hz]) => ({ t, hz })),
    notes: csvRows(join(dir, 'notes.csv')).map(([start, hz, duration]) => ({ start, hz, duration })),
  };
}

/** Feed a whole recording to a block consumer in blocks of `size` (the worklet's 128 by default). */
export function inBlocks<T>(pcm: Float32Array, sampleRate: number, size: number, push: (block: Float32Array, t0: number) => T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < pcm.length; i += size) out.push(...push(pcm.subarray(i, Math.min(pcm.length, i + size)), i / sampleRate));
  return out;
}
