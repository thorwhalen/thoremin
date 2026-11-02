/**
 * The song module's host (#186 PR G): installs the {@link SongHost} the song commands act through
 * (`./songHost.ts`) over the hot store, and the one way a file becomes the loaded song: through the
 * sources' local-file adapter (`./sources.ts`), like a link or a search hit. Imported by the slice's
 * React half (`../ui.tsx`), so the commands work from the palette before the Song tool was ever
 * opened.
 */
import { provideSongHost } from './songHost';
import type { AnalyzeOptions } from './load';
import { setSongPlaying, setSongPrefs, setSongStartBeat, songHandle } from './state';
import { closeMedia, openInput, sessionSong } from './sources';
import type { SongHandle } from '../nodes/song_player.schema';

provideSongHost({
  loaded: () => songHandle()?.name ?? null,
  setPlaying: (playing) => setSongPlaying(playing),
  setVolume: (volume) => setSongPrefs({ volume }),
  setRate: (rate) => setSongPrefs({ rate }),
  setFollow: (follow) => setSongPrefs({ follow }),
  setFollowRange: (followRange) => setSongPrefs({ followRange }),
  setAlignStart: (alignStart) => setSongPrefs({ alignStart }),
  setStartBeat: (beat) => setSongStartBeat(beat),
  setHoldFade: (holdFadeS) => setSongPrefs({ holdFadeS }),
  setHoldSlow: (holdSlow) => setSongPrefs({ holdSlow }),
});

/** Decode and track `file`, then make it the loaded song (stopping the previous one). */
export async function loadSongFile(file: Blob & { name?: string }, opts?: AnalyzeOptions): Promise<SongHandle> {
  const song = sessionSong(await openInput(file, { analyze: opts }));
  if (!song) throw new Error(`${file.name ?? 'the file'} did not open as a song`);
  return song;
}

/** Unload the song (releases its file). */
export function unloadSong(): void {
  closeMedia();
}
