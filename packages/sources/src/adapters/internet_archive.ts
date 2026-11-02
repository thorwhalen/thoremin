/**
 * The Internet Archive: keyless search over its audio items (`advancedsearch.php`) and an item's
 * tracks from its metadata (`/metadata/<id>`); both, and its downloads, send CORS headers, so the
 * audio is decoded on the device (`pcm_local`). Each item states its own licence, shown with it.
 *
 * Search returns music items in the archive's relevance order, spoken-word collections left out
 * (an album is one hit); resolving an item lists its tracks as `parts`, one
 * per original file, each at its best audio derivative (an MP3 first).
 */
import { z } from 'zod';
import { licenceFromUrl } from '../licence';
import { OWNED_TRANSPORT, openOwnedAudio } from '../owned';
import { SourceError, type MediaItem, type SearchHit, type SourceAdapter, type SourceInput, type TransportCapabilities } from '../types';
import { getJson } from './http';

export const INTERNET_ARCHIVE_ID = 'internet-archive';

export interface InternetArchiveOptions {
  fetch?: typeof fetch;
  /** Only items that state a licence (the default): the rest have no stated terms to show. */
  licensedOnly?: boolean;
  /** Hits per search when the caller names no limit. */
  rows?: number;
  /** Collections left out of search: spoken word (audiobooks, podcasts, radio) by default. */
  excludeCollections?: readonly string[];
  host?: string;
  transport?: TransportCapabilities;
}

/** Audio formats, best first: what the song player reads everywhere, then the rest. */
/** The spoken-word collections a music search leaves out. */
export const IA_SPOKEN_WORD_COLLECTIONS = ['librivoxaudio', 'audio_bookspoetry', 'podcasts', 'radioprograms', 'oldtimeradio'] as const;

export const IA_AUDIO_FORMATS = ['VBR MP3', 'MP3', '320Kbps MP3', '256Kbps MP3', '192Kbps MP3', '128Kbps MP3', '64Kbps MP3', 'Ogg Vorbis', 'Flac', 'WAVE', 'AIFF'] as const;

const strOrList = z.union([z.string(), z.array(z.string())]).optional();
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v.join(', ') : v)?.trim() || undefined;

const SearchSchema = z.object({
  response: z.object({
    docs: z.array(z.object({ identifier: z.string(), title: strOrList, creator: strOrList, licenseurl: strOrList }).passthrough()),
  }),
});

const MetadataSchema = z.object({
  metadata: z.object({ identifier: z.string(), title: strOrList, creator: strOrList, licenseurl: strOrList }).passthrough(),
  files: z.array(z.object({ name: z.string(), source: z.string().optional(), format: z.string().optional(), length: z.union([z.string(), z.number()]).optional(), title: z.string().optional(), original: z.string().optional() }).passthrough()),
});
type IaFile = z.infer<typeof MetadataSchema>['files'][number];

/** "08:33", "1:02:03" or "513.56" -> seconds; undefined when unreadable. */
export function parseIaLength(v: string | number | undefined): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (!v) return undefined;
  const parts = v.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Escape the query language's operators, so a title with a colon or a bracket searches as text. */
const escapeQuery = (q: string): string => q.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');

const LINK = /^https?:\/\/(?:www\.)?archive\.org\/(?:details|download)\/([^/?#]+)(?:\/([^?#]+))?/i;

/** `{ id, file? }` from a link, an `id`, or an `id/file`. */
export function parseIaRef(input: string): { id: string; file?: string } | null {
  const m = LINK.exec(input.trim());
  if (m) return { id: decodeURIComponent(m[1]), file: m[2] ? decodeURIComponent(m[2]) : undefined };
  if (/^https?:/i.test(input)) return null;
  const [id, ...rest] = input.trim().split('/');
  return id ? { id, file: rest.length ? rest.join('/') : undefined } : null;
}

/** One playable file per original track, in file order, each at its best audio format. */
export function iaTracks(files: readonly IaFile[]): IaFile[] {
  const rank = (f: IaFile) => {
    const i = IA_AUDIO_FORMATS.indexOf(f.format as (typeof IA_AUDIO_FORMATS)[number]);
    return i < 0 ? Infinity : i;
  };
  const best = new Map<string, IaFile>();
  for (const f of files) {
    if (rank(f) === Infinity) continue;
    const key = f.source === 'derivative' && f.original ? f.original : f.name;
    const was = best.get(key);
    if (!was || rank(f) < rank(was)) best.set(key, f);
  }
  return [...best.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([, f]) => f);
}

const stripExt = (name: string) => name.replace(/\.[a-z0-9]+$/i, '');

export function createInternetArchiveAdapter(opts: InternetArchiveOptions = {}): SourceAdapter {
  const host = opts.host ?? 'https://archive.org';
  const licensedOnly = opts.licensedOnly ?? true;
  const label = 'Internet Archive';
  const downloadUrl = (id: string, file: string) => `${host}/download/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`;
  const pageUrl = (id: string) => `${host}/details/${encodeURIComponent(id)}`;

  return {
    id: INTERNET_ARCHIVE_ID,
    label,
    rights: 'pcm_local',
    capabilities: { search: true, links: true, transport: opts.transport ?? OWNED_TRANSPORT },
    matches: (input: SourceInput) => typeof input === 'string' && LINK.test(input.trim()),
    async search(query, so = {}): Promise<SearchHit[]> {
      const excluded = opts.excludeCollections ?? IA_SPOKEN_WORD_COLLECTIONS;
      const q = [
        `(${escapeQuery(query)})`,
        'mediatype:audio',
        ...(licensedOnly ? ['licenseurl:*'] : []),
        ...(excluded.length ? [`NOT collection:(${excluded.join(' OR ')})`] : []),
      ].join(' AND ');
      // The archive's own relevance order (a download count ranks popular unrelated items first).
      const params = new URLSearchParams({ q, rows: String(so.limit ?? opts.rows ?? 20), output: 'json' });
      for (const f of ['identifier', 'title', 'creator', 'licenseurl']) params.append('fl[]', f);
      const body = await getJson({ id: INTERNET_ARCHIVE_ID, label }, `${host}/advancedsearch.php?${params}`, SearchSchema, { fetch: opts.fetch, signal: so.signal });
      return body.response.docs.map((d) => ({
        source: INTERNET_ARCHIVE_ID,
        id: d.identifier,
        title: first(d.title) ?? d.identifier,
        artist: first(d.creator),
        pageUrl: pageUrl(d.identifier),
        artworkUrl: `${host}/services/img/${encodeURIComponent(d.identifier)}`,
        licence: licenceFromUrl(first(d.licenseurl)),
      }));
    },
    async resolve(input, ro = {}): Promise<MediaItem> {
      if (typeof input !== 'string') throw new SourceError('unsupported', `${label} opens links, not files`, INTERNET_ARCHIVE_ID);
      const ref = parseIaRef(input);
      if (!ref) throw new SourceError('unsupported', `not an ${label} link`, INTERNET_ARCHIVE_ID);
      const body = await getJson({ id: INTERNET_ARCHIVE_ID, label }, `${host}/metadata/${encodeURIComponent(ref.id)}`, MetadataSchema, { fetch: opts.fetch, signal: ro.signal });
      const tracks = iaTracks(body.files);
      if (!tracks.length) throw new SourceError('not-found', `${first(body.metadata.title) ?? ref.id} has no audio file`, INTERNET_ARCHIVE_ID);
      // A named file may be an original or any of its derivatives: play its track's best format.
      const named = ref.file ? body.files.find((f) => f.name === ref.file) : undefined;
      const key = named ? (named.source === 'derivative' && named.original ? named.original : named.name) : undefined;
      const track = key ? tracks.find((t) => t.name === key || t.original === key) : tracks[0];
      if (!track) throw new SourceError('not-found', `${ref.file} is not an audio file of ${ref.id}`, INTERNET_ARCHIVE_ID);
      const itemTitle = first(body.metadata.title) ?? ref.id;
      const trackTitle = track.title?.trim() || stripExt(track.name);
      return {
        source: INTERNET_ARCHIVE_ID,
        id: `${ref.id}/${track.name}`,
        title: tracks.length > 1 ? `${trackTitle} (${itemTitle})` : itemTitle,
        artist: first(body.metadata.creator),
        durationS: parseIaLength(track.length),
        pageUrl: pageUrl(ref.id),
        artworkUrl: `${host}/services/img/${encodeURIComponent(ref.id)}`,
        licence: licenceFromUrl(first(body.metadata.licenseurl)),
        rights: 'pcm_local',
        media: { kind: 'url', url: downloadUrl(ref.id, track.name) },
        parts: tracks.length > 1 ? tracks.map((t) => ({ id: `${ref.id}/${t.name}`, title: t.title?.trim() || stripExt(t.name) })) : undefined,
      };
    },
    open: (item, h) => openOwnedAudio(item, h, { fetch: opts.fetch }),
  };
}
