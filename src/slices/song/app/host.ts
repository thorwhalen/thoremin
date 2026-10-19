/**
 * The song module's host (#186 PR G): installs the {@link SongHost} the song commands act through
 * (`./songHost.ts`) over the hot store, and the one way a file becomes the loaded song. Imported by
 * the slice's React half (`../ui.tsx`), so the commands work from the palette before the Song tool
 * was ever opened.
 */
import { provideSongHost } from './songHost';
import { analyzeSong, type AnalyzeOptions } from './load';
import { setSongHandle, setSongPlaying, setSongPrefs, setSongStartBeat, songHandle } from './state';
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
  const song = await analyzeSong(file, opts);
  setSongHandle(song);
  return song;
}

/** Unload the song (releases its file). */
export function unloadSong(): void {
  setSongHandle(null);
}
