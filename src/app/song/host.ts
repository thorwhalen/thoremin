/**
 * The song module's host (#186 PR G): installs the {@link SongHost} the song commands
 * act through (`src/app/commands/songHost.ts`) over the hot store, and the one way a
 * file becomes the loaded song. Imported by the app shell, so the commands work from the
 * palette before the Song tool was ever opened.
 */
import { provideSongHost } from '@/app/commands/songHost';
import { useControls } from '@/app/store';
import { analyzeSong, type AnalyzeOptions } from './load';
import type { SongHandle } from '@/nodes/output/song_player';

provideSongHost({
  loaded: () => useControls.getState().songHandle?.name ?? null,
  setPlaying: (playing) => useControls.getState().setSongPlaying(playing),
  setVolume: (volume) => useControls.getState().setSongPrefs({ volume }),
  setRate: (rate) => useControls.getState().setSongPrefs({ rate }),
  setFollow: (follow) => useControls.getState().setSongPrefs({ follow }),
  setFollowRange: (followRange) => useControls.getState().setSongPrefs({ followRange }),
  setHoldFade: (holdFadeS) => useControls.getState().setSongPrefs({ holdFadeS }),
});

/** Decode and track `file`, then make it the loaded song (stopping the previous one). */
export async function loadSongFile(file: Blob & { name?: string }, opts?: AnalyzeOptions): Promise<SongHandle> {
  const song = await analyzeSong(file, opts);
  useControls.getState().setSongHandle(song);
  return song;
}

/** Unload the song (releases its file). */
export function unloadSong(): void {
  useControls.getState().setSongHandle(null);
}
