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
import { contextFromUser, EMPTY_USER_ENTRY, hasUserEntry, numberTap, tempoOfRun, UserEntrySchema, type NumberedTap, type UserEntry } from '@thoremin/sdk/context/from_user';
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
  // A file by its name and length: two files of one name are rarely the same length.
  if (handle?.name) return `file:${handle.name}${handle.durationS ? `:${Math.round(handle.durationS)}` : ''}`;
  const score = controls().get()[SCORE_DOC_FIELD] as { title?: string } | null | undefined;
  return score?.title ? `score:${score.title}` : '';
}

/** The pref as stored (absent or unreadable: none); its entries are read one by one. */
function storedPref(): MusicUserPref {
  const parsed = MusicUserPrefSchema.safeParse(controls().get()[MUSIC_USER_PREF]);
  return parsed.success ? parsed.data : DEFAULT_MUSIC_USER;
}

/** The entries this build can read (one it cannot is skipped, and kept in the store). */
export function userPref(): { entries: Record<string, UserEntry> } {
  const entries: Record<string, UserEntry> = {};
  for (const [key, raw] of Object.entries(storedPref().entries)) {
    const parsed = UserEntrySchema.safeParse(raw);
    if (parsed.success) entries[key] = parsed.data;
  }
  return { entries };
}

/** The entry for a piece (an empty one when the player said nothing about it). */
function entryFor(key: string): UserEntry {
  const parsed = UserEntrySchema.safeParse(storedPref().entries[key]);
  return parsed.success ? parsed.data : EMPTY_USER_ENTRY;
}

/** The entry for the piece now. */
export const currentEntry = (): UserEntry => entryFor(pieceKey());

/** Write the entry for the piece now (an empty entry is removed). False when no piece is loaded. */
export function writeEntry(update: (e: UserEntry) => UserEntry): boolean {
  const key = pieceKey();
  if (!key) return false;
  const entries = { ...storedPref().entries };
  const next = UserEntrySchema.parse(update(entryFor(key)));
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
/** The output stage (seconds from the song's position to the speaker), from the timing resource. */
let outputStageS = 0;
/** The song player's count of the position moves it made (its `jumps`, #945); null when unknown. */
let songJumps: number | null = null;

/** The status hook's sink: the song player's latest reading, the output stage, and its jumps. */
export const mirrorSongTime = (time: MusicalTime | null | undefined, stageS = 0, jumps?: number): void => {
  lastSongTime = time ?? null;
  outputStageS = Number.isFinite(stageS) && stageS > 0 ? stageS : 0;
  songJumps = typeof jumps === 'number' ? jumps : null;
};

/**
 * The song position (song seconds) the player HEARS at engine time `now`, or null when no song is
 * playing: the position extrapolated to `now`, less what the output stage still holds (the
 * player taps on the beat they hear, which left the player that long ago).
 */
export function songPositionAt(now: number, time: MusicalTime | null = lastSongTime): number | null {
  if (!time || typeof time.position !== 'number' || !Number.isFinite(time.position)) return null;
  // A paused song (rate 0, or a held grid) has no beat to tap along to.
  if (time.state === 'hold' || time.rate === 0) return null;
  const rate = typeof time.rate === 'number' && time.rate > 0 ? time.rate : 1;
  return Math.max(0, time.position + (Math.max(0, now - time.t) - outputStageS) * rate);
}

/** The run: each tap's song position numbered by its beat (the first is beat 0, the downbeat),
 *  and the engine time of the last one (to tell a seek). */
let taps: NumberedTap[] = [];
let lastTapNow = 0;
/** The song player's jumps at the last tap: a different count is a seek since (#945). */
let jumpsAtLastTap: number | null = null;
/** How many taps a run keeps: its first (the downbeat) and the latest; their beat numbers are kept
 *  with them, so dropping the middle moves nothing. */
const MAX_TAPS = 128;
/** A song that moved this much more or less than the clock between two taps was sought (plus a
 *  share of the gap, for a rate that changed in between): the backstop for a move the song player
 *  did not make itself (a scrub in a provider's own player), since a short one escapes it. The
 *  player's own moves are counted exactly (`jumps`). */
const SEEK_TOLERANCE_S = 0.15;
const SEEK_RATE_SLACK = 0.12;

/** One tap at engine time `now`: the tempo once there are enough taps (only the count before), or
 *  'no-song'. A seek between taps starts the run again: one the song player made (its `jumps`
 *  changed, #945), or the song having moved otherwise than the clock. */
export function tap(now: number): { bpm: number; taps: number } | { taps: number } | 'no-song' {
  const at = songPositionAt(now);
  if (at === null) return 'no-song';
  const last = taps[taps.length - 1];
  const rate = lastSongTime?.rate && lastSongTime.rate > 0 ? lastSongTime.rate : 1;
  const dt = now - lastTapNow;
  const jumped = songJumps !== null && jumpsAtLastTap !== null && songJumps !== jumpsAtLastTap;
  if (last && (jumped || Math.abs(at - last.t - dt * rate) > SEEK_TOLERANCE_S + SEEK_RATE_SLACK * dt * rate)) taps = [];
  lastTapNow = now;
  jumpsAtLastTap = songJumps;
  taps = numberTap(taps, at).run;
  if (taps.length > MAX_TAPS) taps = [taps[0], ...taps.slice(taps.length - MAX_TAPS + 1)];
  const beatsPerBar = currentEntry().tempo?.beatsPerBar ?? 4;
  const tempo = tempoOfRun(taps, { beatsPerBar });
  if (!tempo) return { taps: taps.length };
  writeEntry((e) => ({ ...e, tempo }));
  return { bpm: tempo.bpm, taps: taps.length };
}

/** Forget the taps (and, with `tempo`, the tempo they made). */
export function clearTaps({ tempo = false }: { tempo?: boolean } = {}): void {
  taps = [];
  jumpsAtLastTap = null;
  if (tempo) writeEntry((e) => ({ ...e, tempo: null }));
}

/** Whether a chart written now would be placed: a tapped tempo, a song with a beat grid, or a
 *  loaded score (the chart then goes on the score's bars: `combineLayers`). */
export function chartPlaceable(): boolean {
  if (currentEntry().tempo) return true;
  const h = song();
  if (h?.grid?.beats && h.grid.beats.length >= 2) return true;
  return !!controls().get()[SCORE_DOC_FIELD];
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
