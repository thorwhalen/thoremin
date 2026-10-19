/**
 * The song's hot-store state (#600 S15), read and written through the SDK's controls seam: the
 * loaded song, its transport and press counter, the conductor's start beat (all transient) and the
 * per-device pref. What core's store setters did for the song, moved with it: replacing the song
 * releases the old file and stops the transport; a Play counts a press.
 */
import { useSyncExternalStore } from 'react';
import { controls } from '@thoremin/sdk-ui/host';
import type { SongHandle } from '../nodes/song_player.schema';
import { DEFAULT_SONG, SONG_PREFS, SongSettingsSchema, type SongSettings } from '../schema';

const field = <T>(key: string, fallback: T): T => (controls().get()[key] as T | undefined) ?? fallback;

/** The loaded song, or null. */
export const songHandle = (): SongHandle | null => field<SongHandle | null>('songHandle', null);
export const songPlaying = (): boolean => field('songPlaying', false);
/** How many times Play was pressed (#344). */
export const songPlays = (): number => field('songPlays', 0);
export const songStartBeat = (): number => field('songStartBeat', 0);
export const songPrefs = (): SongSettings => field(SONG_PREFS, DEFAULT_SONG);

/** Release a replaced song's object URL (a local file's bytes stay alive until it is). */
function releaseSongUrl(song: SongHandle | null): void {
  if (song?.url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(song.url);
}

/** Replace the loaded song: releases the previous one's file, stops the transport and resets the start beat. */
export function setSongHandle(song: SongHandle | null): void {
  const was = songHandle();
  if (was === song) return;
  releaseSongUrl(was);
  const c = controls();
  c.setTransient('songPlaying', false);
  c.setTransient('songStartBeat', 0);
  c.setTransient('songHandle', song);
}

/** Start or stop the transport; a start also counts a press (#344), so the player reads a Play
 *  even when the level never fell. */
export function setSongPlaying(on: boolean): void {
  const c = controls();
  if (on) c.setTransient('songPlays', field('songPlays', 0) + 1);
  c.setTransient('songPlaying', on);
}

/** The song beat the conductor's first beat lands on (#364); a negative or non-finite value is
 *  ignored, a fraction rounds. */
export function setSongStartBeat(beat: number): void {
  if (!Number.isFinite(beat) || beat < 0 || Math.round(beat) === songStartBeat()) return;
  controls().setTransient('songStartBeat', Math.round(beat));
}

/** Patch the per-device pref; an invalid value is ignored. */
export function setSongPrefs(patch: Partial<SongSettings>): void {
  const r = SongSettingsSchema.safeParse({ ...songPrefs(), ...patch });
  if (r.success) controls().setPref(SONG_PREFS, r.data);
}

/** A React hook over one reading of the song's state (`useSongField(songHandle)`): re-renders when
 *  the reading changes. The reading must return a stable value (a field, a primitive). */
export function useSongField<T>(read: () => T): T {
  return useSyncExternalStore((listener) => controls().subscribe(listener), read, read);
}
