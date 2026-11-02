/**
 * The song slice's sources (`@thoremin/sources`): the registry the Song tool searches and opens
 * through, the host that plays owned audio in the `song-player` node, and the active playback
 * session.
 *
 * Every way a song arrives goes through here: a chosen file (the local-file adapter), a pasted
 * link, a search hit. Owned audio becomes a {@link SongHandle} carrying its source item, and the
 * session's transport is the song's hot-store transport, so the player publishes `songTime` for it
 * exactly as for any song. {@link activeSession} is what another module reads to know what is
 * playing and under which rights; {@link analysisRefusal} is the check an analyser makes.
 */
import { create } from 'zustand';
import {
  allows,
  assertAllows,
  createSourceRegistry,
  defaultAdapters,
  OWNED_TRANSPORT,
  YOUTUBE_KEY_SETTING,
  type MediaItem,
  type PlaybackSession,
  type SearchHit,
  type SessionEvent,
  type SourceHost,
  type Jsonp,
  type SourceAdapter,
  type SourceInput,
  type TransportCapabilities,
} from '@thoremin/sources';
import { provideListeningGate } from '@thoremin/sdk-ui/listening';
import { providerKey } from '@thoremin/sdk-ui/keys';
import { contributedSourceAdapters, onSourceAdaptersChange } from '@thoremin/sdk-ui/sources';
import { analyzeSong, type AnalyzeOptions } from './load';
import { createEmbedMount, embedSession, embedSong } from './embeds';
import { requestSongSeek, setSongHandle, setSongPlaying, setSongPrefs, songHandle } from './state';
import { songPosition, useSongStatus } from './songStatus';
import { SONG_RATE_MAX, SONG_RATE_MIN } from '../schema';
import type { SongHandle } from '../nodes/song_player.schema';

/** The song player's transport, as its sessions state it. */
export const SONG_TRANSPORT: TransportCapabilities = { ...OWNED_TRANSPORT, rate: { min: SONG_RATE_MIN, max: SONG_RATE_MAX } };

/** How the catalogues are reached (a test's stand-ins; the browser's own by default). */
let reach: { fetch?: typeof fetch; jsonp?: Jsonp } = {};

const build = () => createSourceRegistry(defaultAdapters({ ...reach, transport: SONG_TRANSPORT, youtubeKey: () => providerKey(YOUTUBE_KEY_SETTING.provider), extra: contributedSourceAdapters() }));

/** Reach the catalogues through other means (a test); the registry is rebuilt. */
export function configureSourceReach(next: { fetch?: typeof fetch; jsonp?: Jsonp }): void {
  reach = next;
  SOURCES = build();
}

/** The adapters a search asks now: every searchable one whose key, if it needs one, is set. */
export function searchReady(): SourceAdapter[] {
  return SOURCES.searchable().filter((a) => !a.keySetting || providerKey(a.keySetting.provider) !== null);
}

/** The sources this build ships, in link order. */
export let SOURCES = build();

// A build's own adapters (`@thoremin/sdk-ui/sources`: the lab build's streaming embeds) join it.
onSourceAdaptersChange(() => {
  SOURCES = build();
});

interface ActiveSessionState {
  session: PlaybackSession | null;
}

/** The open session, or null. Read it through {@link activeSession} outside React. */
export const useActiveSession = create<ActiveSessionState>(() => ({ session: null }));

/** The song each owned session plays, so a session whose song was replaced reads as closed. */
const songOf = new WeakMap<PlaybackSession, SongHandle>();

/** The open session, or null (also when its song was replaced some other way). */
export function activeSession(): PlaybackSession | null {
  const s = useActiveSession.getState().session;
  if (!s) return null;
  const song = songOf.get(s);
  return song && songHandle() !== song ? null : s;
}

/**
 * Why audio analysis must not run now, or null when it may: while the active session's rights
 * forbid analysing it (an embed), nothing listens, not even through the microphone.
 */
export function analysisRefusal(): string | null {
  const s = activeSession();
  if (!s || allows(s.item.rights, 'analyse')) return null;
  return `Listening is off while ${s.item.title} plays from ${SOURCES.get(s.item.source).label}`;
}

/** A session over the song player's hot-store transport, for `song`. */
export function ownedSession(item: MediaItem, song: SongHandle): PlaybackSession {
  const listeners: Record<SessionEvent, Set<() => void>> = { state: new Set(), ended: new Set(), buffering: new Set() };
  let closed = false;
  const live = () => !closed && songHandle() === song;
  const emit = (e: SessionEvent) => listeners[e].forEach((l) => l());
  const unsubscribe = useSongStatus.subscribe((now, was) => {
    if (!live() || now.status === was.status) return;
    emit('state');
    if (now.status.reason === 'ended' && was.status.reason !== 'ended') emit('ended');
    if (now.status.phase === 'loading' && was.status.phase !== 'loading') emit('buffering');
  });
  const session: PlaybackSession = {
    item,
    capabilities: SONG_TRANSPORT,
    play: () => live() && setSongPlaying(true),
    pause: () => live() && setSongPlaying(false),
    seek: (positionS) => live() && requestSongSeek(positionS),
    setRate: (rate) => live() && setSongPrefs({ rate: Math.max(SONG_RATE_MIN, Math.min(SONG_RATE_MAX, rate)) }),
    setVolume: (volume) => live() && setSongPrefs({ volume: Math.max(0, Math.min(1, volume)) }),
    position: () => (live() ? songPosition() : 0),
    playing: () => live() && useSongStatus.getState().status.phase === 'active',
    on(event, listener) {
      listeners[event].add(listener);
      return () => listeners[event].delete(listener);
    },
    close() {
      if (closed) return;
      const mine = live();
      closed = true;
      unsubscribe();
      for (const set of Object.values(listeners)) set.clear();
      if (mine) setSongHandle(null);
    },
  };
  songOf.set(session, song);
  return session;
}

/** The song an owned session plays (null for another kind of session). */
export function sessionSong(session: PlaybackSession): SongHandle | null {
  return songOf.get(session) ?? null;
}

/** Thrown at an open that a later one replaced before it finished. */
export class SupersededOpen extends Error {
  constructor(title: string) {
    super(`${title} was replaced by a later choice`);
    this.name = 'AbortError';
  }
}

/** Counts opens, so only the latest one requested may become the song. */
let opening = 0;

/** The host every adapter opens through; `analyze` is injectable (tests: jsdom decodes nothing).
 *  `current` says whether this open is still the latest one requested. */
export function songSourceHost(analyze: AnalyzeOptions = {}, current: () => boolean = () => true): SourceHost {
  return {
    async openOwned(item, bytes) {
      // The host decodes and tracks the beat: both need the item's rights, whatever the adapter did.
      assertAllows(item, 'decode');
      assertAllows(item, 'analyse');
      const song = await analyzeSong(bytes, { ...analyze, name: item.title });
      if (!current()) {
        if (song.url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(song.url);
        throw new SupersededOpen(item.title);
      }
      const withItem: SongHandle = { ...song, item };
      setSongHandle(withItem);
      return ownedSession(item, withItem);
    },
    async openEmbed(item, makePlayer) {
      const label = SOURCES.get(item.source).label;
      let session: PlaybackSession | null = null;
      const mount = createEmbedMount(item, label, () => (session && useActiveSession.getState().session === session ? closeMedia() : session?.close()));
      const player = makePlayer(mount.body, item);
      try {
        await player.ready;
      } catch (e) {
        player.dispose();
        mount.remove();
        throw e;
      }
      if (!current()) {
        player.dispose();
        mount.remove();
        throw new SupersededOpen(item.title);
      }
      const song = embedSong(item, player);
      setSongHandle(song);
      session = embedSession(item, song, player, mount);
      return session;
    },
  };
}

/** Open `item` as the active session (closing the previous one). Rejects, leaving the previous
 *  session playing, when it cannot be opened; rejects with an `AbortError` when a later open
 *  replaced it first (the latest request wins, whichever finishes first). */
export async function openMedia(item: MediaItem, opts: { analyze?: AnalyzeOptions } = {}): Promise<PlaybackSession> {
  const mine = ++opening;
  const session = await SOURCES.open(item, songSourceHost(opts.analyze, () => mine === opening));
  const was = useActiveSession.getState().session;
  if (was && was !== session) {
    // Its song was already replaced by the new one; close only releases its listeners.
    was.close();
  }
  useActiveSession.setState({ session });
  return session;
}

/** Resolve a pasted link or a chosen file and open it. */
export async function openInput(input: SourceInput, opts: { analyze?: AnalyzeOptions; signal?: AbortSignal } = {}): Promise<PlaybackSession> {
  return openMedia(await SOURCES.resolveInput(input, { signal: opts.signal }), opts);
}

/** Resolve a search hit (an item, with its other parts listed) without opening it. */
export function resolveHit(hit: SearchHit, opts: { signal?: AbortSignal } = {}): Promise<MediaItem> {
  return SOURCES.resolveHit(hit, opts);
}

/** Close the active session (unloads its song). */
export function closeMedia(): void {
  const was = useActiveSession.getState().session;
  useActiveSession.setState({ session: null });
  was?.close();
}

// The listening gate: shut while the active session's rights forbid analysing what plays.
provideListeningGate({
  refusal: analysisRefusal,
  subscribe: (fn) => {
    const off = useActiveSession.subscribe(fn);
    return off;
  },
});
