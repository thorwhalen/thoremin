/**
 * The player's producer, live, and the host its commands write through.
 *
 * - `pieceKey`: which piece the player's entries belong to: the loaded song's source item, else its
 *   file name, else the score being conducted, else none.
 * - `startUserContext`: whenever the entries or the loaded song change, the entry for the piece is
 *   read into a timeline (`contextFromUser`: the song's own beat grid is the chart's ruler until a
 *   tempo is tapped) and published as the `user` layer, on the song's clock.
 * - The tap: each tap is placed at the song's position now (the song player's last `songTime`,
 *   mirrored by a status hook, extrapolated to the tap); the taps make the tempo (`tempoFromTaps`),
 *   written into the entry once there are enough of them.
 */
import { controls } from '@thoremin/sdk-ui/host';
import { contextFromUser, EMPTY_USER_ENTRY, hasUserEntry, tempoFromTaps, UserEntrySchema, type UserEntry } from '@thoremin/sdk/context/from_user';
import type { MusicalTime } from '@thoremin/ictus';
import { DEFAULT_MUSIC_USER, MAX_USER_ENTRIES, MUSIC_USER_PREF, MusicUserPrefSchema, type MusicUserPref } from '../schema';
import { setLayer } from './active';

/** The loaded song's hot-store field (the song slice's transient), read by its shape. */
export const SONG_HANDLE_FIELD = 'songHandle';
interface SongLike {
  name?: string;
  durationS?: number;
  grid?: { beats?: readonly number[] };
  item?: { source?: string; id?: string };
}

const song = (): SongLike | null => (controls().get()[SONG_HANDLE_FIELD] as SongLike | null | undefined) ?? null;

/** The loaded score's hot-store field (the conductor slice's transient), read by its title. */
const SCORE_DOC_FIELD = 'scoreDoc';

/** The piece the player's entries are about now: the loaded song's source item, else its file
 *  name; else the score being conducted, by its title; '' for none. */
export function pieceKey(handle: SongLike | null = song()): string {
  if (handle?.item?.source && handle.item.id) return `${handle.item.source}:${handle.item.id}`;
  if (handle?.name) return `file:${handle.name}`;
  const score = controls().get()[SCORE_DOC_FIELD] as { title?: string } | null | undefined;
  return score?.title ? `score:${score.title}` : '';
}

/** The pref, read (absent or unreadable: none). */
export function userPref(): MusicUserPref {
  const parsed = MusicUserPrefSchema.safeParse(controls().get()[MUSIC_USER_PREF]);
  return parsed.success ? parsed.data : DEFAULT_MUSIC_USER;
}

/** The entry for the piece now (an empty one when the player said nothing about it). */
export const currentEntry = (): UserEntry => userPref().entries[pieceKey()] ?? EMPTY_USER_ENTRY;

/** Write the entry for the piece now (an empty entry is removed). False when no piece is loaded. */
export function writeEntry(update: (e: UserEntry) => UserEntry): boolean {
  const key = pieceKey();
  if (!key) return false;
  const entries = { ...userPref().entries };
  const next = UserEntrySchema.parse(update(entries[key] ?? EMPTY_USER_ENTRY));
  delete entries[key];
  if (hasUserEntry(next)) entries[key] = next;
  // The oldest go first past the cap (records keep insertion order: the latest written is last).
  const keys = Object.keys(entries);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_USER_ENTRIES))) delete entries[old];
  controls().setPref(MUSIC_USER_PREF, { entries });
  return true;
}

// ---- the song's position, for the taps ---------------------------------------------------------

let lastSongTime: MusicalTime | null = null;

/** The status hook's sink: the song player's latest reading. */
export const mirrorSongTime = (time: MusicalTime | null | undefined): void => {
  lastSongTime = time ?? null;
};

/** The song position (song seconds) at engine time `now`, or null when no song is playing. */
export function songPositionAt(now: number, time: MusicalTime | null = lastSongTime): number | null {
  if (!time || typeof time.position !== 'number' || !Number.isFinite(time.position)) return null;
  // A paused song (rate 0, or a held grid) has no beat to tap along to.
  if (time.state === 'hold' || time.rate === 0) return null;
  const rate = typeof time.rate === 'number' && time.rate > 0 ? time.rate : 1;
  return time.position + Math.max(0, now - time.t) * rate;
}

let taps: number[] = [];
/** Taps older than this (seconds of song) before the latest are dropped. */
const TAP_MEMORY_S = 20;

/** One tap at engine time `now`: the tempo once there are enough taps (null before), or 'no-song'. */
export function tap(now: number): { bpm: number; taps: number } | { taps: number } | 'no-song' {
  const at = songPositionAt(now);
  if (at === null) return 'no-song';
  // A tap behind the last one (a seek back) starts again.
  if (taps.length && at < taps[taps.length - 1]) taps = [];
  taps = [...taps.filter((t) => at - t <= TAP_MEMORY_S), at];
  const beatsPerBar = currentEntry().tempo?.beatsPerBar ?? 4;
  const tempo = tempoFromTaps(taps, { beatsPerBar });
  if (!tempo) return { taps: taps.length };
  writeEntry((e) => ({ ...e, tempo }));
  return { bpm: tempo.bpm, taps: taps.length };
}

/** Forget the taps (and, with `tempo`, the tempo they made). */
export function clearTaps({ tempo = false }: { tempo?: boolean } = {}): void {
  taps = [];
  if (tempo) writeEntry((e) => ({ ...e, tempo: null }));
}

// ---- the producer -------------------------------------------------------------------------------

/** Start following the player's entries and the loaded song; returns the stop. */
export function startUserContext(): () => void {
  let lastPref: unknown = undefined;
  let lastSong: unknown = undefined;
  let lastScore: unknown = undefined;
  const apply = (): void => {
    const state = controls().get();
    const pref = state[MUSIC_USER_PREF];
    const handle = state[SONG_HANDLE_FIELD];
    const score = state[SCORE_DOC_FIELD];
    if (pref === lastPref && handle === lastSong && score === lastScore) return;
    lastScore = score;
    if (handle !== lastSong) taps = [];
    lastPref = pref;
    lastSong = handle;
    const h = (handle as SongLike | null | undefined) ?? null;
    const entry = currentEntry();
    if (!hasUserEntry(entry)) {
      setLayer('user', null);
      return;
    }
    const ruler = h?.grid?.beats && h.grid.beats.length >= 2 ? h.grid.beats : undefined;
    const context = contextFromUser(entry, { ruler, durationS: h?.durationS ?? 0, contentKey: pieceKey(h) });
    setLayer('user', { active: { context, clock: 'song' }, entry });
  };
  apply();
  const unsubscribe = controls().subscribe(apply);
  return () => {
    unsubscribe();
    setLayer('user', null);
  };
}
