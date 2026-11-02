/**
 * The source layer's vocabulary: what a provider adapter declares, what an item carries, and the
 * transport every playback session offers. Types only; the behaviour is in `registry.ts`,
 * `rights.ts`, `owned.ts` and the adapters.
 *
 * Three seams, each a strategy slot:
 * - {@link SourceAdapter}: one module per provider, registered as data. It may search, it resolves
 *   a link, an id or a file to a {@link MediaItem}, and it opens an item as a session.
 * - {@link Rights}: the profile an item carries. The core reads it on the one path every item
 *   takes (`createSourceRegistry().open`) and every decode takes (`fetchOwnedBytes`), so an adapter
 *   cannot route an item to a use its profile forbids.
 * - {@link PlaybackSession}: the transport (play, pause, seek, rate, volume, position, events),
 *   with its timing figures stated, so a controller degrades to what the session can do.
 */

/** The rights profiles, from the most restricted. */
export const RIGHTS = ['embed_only', 'pcm_local', 'pcm_redistributable', 'symbolic'] as const;
/**
 * What may be done with an item's media:
 * - `embed_only`: played only in the provider's own visible player, never decoded or analysed
 *   (also not through the microphone while it plays);
 * - `pcm_local`: decoded and analysed on the device, nothing uploaded or cached elsewhere;
 * - `pcm_redistributable`: may also be cached and analysed off the device;
 * - `symbolic`: a score, not audio.
 */
export type Rights = (typeof RIGHTS)[number];

/** A use of an item's media the core checks against its {@link Rights}. */
export type MediaUse = 'decode' | 'analyse' | 'cache';

/** An item's licence as the provider states it. `name` is the provider's words or 'not stated';
 *  it is shown, never used to widen an item's rights. */
export interface Licence {
  name: string;
  url?: string;
}

/** Where an item's media is. */
export type MediaRef =
  | { kind: 'url'; url: string }
  | { kind: 'blob'; blob: Blob }
  /** A provider's own player, by its embed address (no media of ours). */
  | { kind: 'embed'; embedUrl: string };

/** A search result: enough to show it and to resolve it (by `id`, with its `source`'s adapter). */
export interface SearchHit {
  /** The adapter id. */
  source: string;
  /** What the adapter resolves (an item id, or a track id). */
  id: string;
  title: string;
  artist?: string;
  durationS?: number;
  /** The item's page at the provider (the backlink a player is shown). */
  pageUrl?: string;
  artworkUrl?: string;
  licence?: Licence;
}

/** A resolved, openable item. */
export interface MediaItem extends SearchHit {
  rights: Rights;
  media: MediaRef;
  /** A provider's own player, when the media is an embed: its capabilities may be narrower than
   *  the adapter's (a provider that plays this item with no remote control). */
  embedTransport?: TransportCapabilities;
  /** The other playable parts of the same release (an archive item's other tracks), each
   *  resolvable by its id with the same adapter. */
  parts?: { id: string; title: string }[];
}

/** A rate range; `steps` when only those rates exist (a provider that rounds to them). */
export interface RateSupport {
  min: number;
  max: number;
  steps?: readonly number[];
}

/** A timing figure and where it comes from: measured on this device, or stated (by construction
 *  or by the provider's documentation). */
export interface TimingFigure {
  s: number;
  source: 'measured' | 'stated';
}

/** What a session's transport can do, honestly: null where it cannot or nobody knows. */
export interface TransportCapabilities {
  /** `play` and `pause` reach the player (false for a player only its own buttons control). */
  play: boolean;
  /** `position()` is known (false for a player that reports nothing). */
  position: boolean;
  seek: boolean;
  rate: RateSupport | null;
  volume: boolean;
  /** Seconds between `pause()` and the sound stopping. */
  pauseLead: TimingFigure | null;
  /** The smallest step `seek` lands on (0 = sample-accurate). */
  seekGranularity: TimingFigure | null;
  /** How far behind the sound `position()` can be (a polled player's poll interval and lag). */
  positionLag: TimingFigure | null;
}

/** What an adapter declares about itself, as data. */
export interface SourceCapabilities {
  /** The adapter answers `search`. */
  search: boolean;
  /** The adapter recognises pasted links (`matches`). */
  links: boolean;
  /** The transport its sessions offer. */
  transport: TransportCapabilities;
}

export type SessionEvent = 'state' | 'ended' | 'buffering';

/** The transport seam. Optional verbs are absent when `capabilities` says the session lacks them. */
export interface PlaybackSession {
  readonly item: MediaItem;
  readonly capabilities: TransportCapabilities;
  play(): void;
  pause(): void;
  seek?(positionS: number): void;
  setRate?(rate: number): void;
  setVolume?(volume: number): void;
  /** Seconds into the item. */
  position(): number;
  playing(): boolean;
  /** Subscribe; returns the unsubscribe. */
  on(event: SessionEvent, listener: () => void): () => void;
  /** Stop and release the session. */
  close(): void;
}

/** What opening an item needs from the app: the ways it can be played. */
export interface SourceHost {
  /** Play decodable audio (the bytes, already fetched under the item's rights) through the
   *  instrument's own song player. */
  openOwned(item: MediaItem, bytes: Blob): Promise<PlaybackSession>;
  /** Play an item in its provider's own player, mounted visibly by the host. Absent in a host that
   *  shows no embeds. */
  openEmbed?(item: MediaItem, player: EmbedPlayerFactory): Promise<PlaybackSession>;
}

export type EmbedEvent = 'state' | 'ended' | 'buffering' | 'error';

/** A provider's player in an element the host shows: the provider's SDK behind one shape. The
 *  optional verbs exist exactly when `capabilities` says so. */
export interface EmbedPlayer {
  readonly capabilities: TransportCapabilities;
  /** Resolves when the player can be controlled; rejects (with a reason in words) when the item
   *  cannot be embedded. */
  ready: Promise<void>;
  play(): void;
  pause(): void;
  seek?(positionS: number): void;
  /** Asks for a rate; returns the rate the player applied (a provider rounds to its steps). */
  setRate?(rate: number): number;
  setVolume?(volume: number): void;
  /** Seconds into the item, extrapolated between the provider's reports while it plays. */
  position(): number;
  durationS(): number;
  playing(): boolean;
  ended(): boolean;
  /** Why the player stopped working, in words (after an `error` event), or null. */
  error?(): string | null;
  on(event: EmbedEvent, listener: () => void): () => void;
  dispose(): void;
}

/** Makes a provider's player inside `container` for `item`. */
export type EmbedPlayerFactory = (container: HTMLElement, item: MediaItem) => EmbedPlayer;

export interface SearchOptions {
  /** At most this many hits from this adapter. */
  limit?: number;
  signal?: AbortSignal;
}

/** The input an adapter resolves: a pasted link or an id (string), or a file the player chose. */
export type SourceInput = string | Blob;

/** A key the player supplies for an adapter, described for the settings that ask for it. */
export interface KeySetting {
  /** Where the key is stored (the app's key store's provider id). */
  provider: string;
  label: string;
  /** What the key does and where it stays, in words. */
  help: string;
  /** Where to get one. */
  url: string;
}

/** One provider. Registered as data; the registry is the only caller. */
export interface SourceAdapter {
  id: string;
  label: string;
  /** The widest rights any item of this adapter may carry. */
  rights: Rights;
  capabilities: SourceCapabilities;
  /** The player's own key this adapter's search needs (stored on the device by the app, read
   *  back through the adapter's `getKey`): the setting the adapter owns. */
  keySetting?: KeySetting;
  /** Whether a pasted link (or a file) is this adapter's to resolve. */
  matches?(input: SourceInput): boolean;
  search?(query: string, opts?: SearchOptions): Promise<SearchHit[]>;
  /** `hit` is the search hit being resolved, when it is one (its title and artist, for an adapter
   *  whose items carry no metadata of their own). */
  resolve(input: SourceInput, opts?: { signal?: AbortSignal; hit?: SearchHit }): Promise<MediaItem>;
  open(item: MediaItem, host: SourceHost): Promise<PlaybackSession>;
}

/** Why a source call failed, so the panel can say it in words. */
export type SourceErrorReason = 'network' | 'cors' | 'not-found' | 'unsupported' | 'rights' | 'bad-response' | 'unknown-source' | 'needs-key';

export class SourceError extends Error {
  readonly reason: SourceErrorReason;
  readonly source?: string;
  constructor(reason: SourceErrorReason, message: string, source?: string) {
    super(message);
    this.name = 'SourceError';
    this.reason = reason;
    this.source = source;
  }
}
