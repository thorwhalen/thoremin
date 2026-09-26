/**
 * Where the air-instrument data lives (#air). Nothing here is ever committed: raw
 * YouTube video, the landmark streams decoded from it, the audio-derived chord labels,
 * the joined datasets, trained weights and evaluation results are all DERIVED FROM A
 * PRIVATE-LICENCE SOURCE and this repository is public. They live in the app-data dir
 * (`~/.local/share/thoremin/`, the ecosystem's `app-data-lifecycle` rule), one kind per
 * subdirectory, one instrument per leaf, so a deploy or a `git clean` can never touch
 * them and a `git add` can never pick them up.
 *
 * Override the root with `THOREMIN_DATA_DIR` (tests point it at a temp dir).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const AIR_DATA_KINDS = ['videos', 'landmarks', 'labels', 'datasets', 'models', 'results'] as const;
export type AirDataKind = (typeof AIR_DATA_KINDS)[number];

export const AIR_INSTRUMENTS = ['guitar', 'flute', 'bass', 'drums'] as const;
export type AirInstrument = (typeof AIR_INSTRUMENTS)[number];

/** The app-data root: `$THOREMIN_DATA_DIR` or `~/.local/share/thoremin`. */
export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.THOREMIN_DATA_DIR ?? join(homedir(), '.local', 'share', 'thoremin');
}

/** `<root>/<kind>/air/<instrument>` — the one place a script may read or write. */
export function airDir(kind: AirDataKind, instrument: AirInstrument, env?: NodeJS.ProcessEnv): string {
  return join(dataRoot(env), kind, 'air', instrument);
}

/** Landmark stream for one source video, in the shape `scripts/video_to_landmarks.py` writes. */
export function landmarksPath(instrument: AirInstrument, videoId: string, env?: NodeJS.ProcessEnv): string {
  return join(airDir('landmarks', instrument, env), `${videoId}.src.hands.ndjson`);
}

/** Chord-segment labels for one source video, in the shape `scripts/air/label_chords.py` writes. */
export function chordLabelsPath(instrument: AirInstrument, videoId: string, env?: NodeJS.ProcessEnv): string {
  return join(airDir('labels', instrument, env), `${videoId}.chords.json`);
}
