/**
 * Audius: keyless search and streams (`api.audius.co/v1`), CORS-enabled, so a track is decoded on
 * the device (`pcm_local`). Tracks gated behind a purchase or a follow, or not streamable, are left
 * out of the hits. Every request carries the app name the API asks for.
 */
import { z } from 'zod';
import { LICENCE_NOT_STATED } from '../licence';
import { OWNED_TRANSPORT, openOwnedAudio } from '../owned';
import { SourceError, type MediaItem, type SearchHit, type SourceAdapter, type SourceInput, type TransportCapabilities } from '../types';
import { getJson } from './http';

export const AUDIUS_ID = 'audius';

export interface AudiusOptions {
  fetch?: typeof fetch;
  appName?: string;
  host?: string;
  /** Hits per search when the caller names no limit. */
  limit?: number;
  transport?: TransportCapabilities;
}

const TrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  duration: z.number().optional(),
  permalink: z.string().optional(),
  is_streamable: z.boolean().optional().nullable(),
  is_stream_gated: z.boolean().optional().nullable(),
  is_available: z.boolean().optional().nullable(),
  license: z.string().optional().nullable(),
  user: z.object({ name: z.string().optional(), handle: z.string().optional() }).passthrough().optional(),
  artwork: z.record(z.string(), z.unknown()).optional().nullable(),
}).passthrough();
type Track = z.infer<typeof TrackSchema>;

const LINK = /^https?:\/\/(?:www\.)?audius\.co\/[^/?#]+\/[^/?#]+/i;

/** Whether a track may be streamed with no account. */
export const audiusStreamable = (t: Track): boolean => t.is_streamable !== false && t.is_stream_gated !== true && t.is_available !== false;

export function createAudiusAdapter(opts: AudiusOptions = {}): SourceAdapter {
  const host = opts.host ?? 'https://api.audius.co/v1';
  const app = opts.appName ?? 'thoremin';
  const label = 'Audius';
  const q = (params: Record<string, string>) => new URLSearchParams({ ...params, app_name: app }).toString();
  const hitOf = (t: Track): SearchHit => {
    const art = t.artwork?.['150x150'];
    return {
      source: AUDIUS_ID,
      id: t.id,
      title: t.title,
      artist: t.user?.name || t.user?.handle,
      durationS: t.duration,
      pageUrl: t.permalink ? `https://audius.co${t.permalink}` : undefined,
      artworkUrl: typeof art === 'string' ? art : undefined,
      licence: { name: t.license?.trim() || LICENCE_NOT_STATED },
    };
  };
  const itemOf = (t: Track): MediaItem => {
    if (!audiusStreamable(t)) throw new SourceError('unsupported', `${t.title} cannot be streamed without an account on ${label}`, AUDIUS_ID);
    return { ...hitOf(t), rights: 'pcm_local', media: { kind: 'url', url: `${host}/tracks/${encodeURIComponent(t.id)}/stream?${q({})}` } };
  };
  const one = z.object({ data: TrackSchema });

  return {
    id: AUDIUS_ID,
    label,
    rights: 'pcm_local',
    capabilities: { search: true, links: true, transport: opts.transport ?? OWNED_TRANSPORT },
    matches: (input: SourceInput) => typeof input === 'string' && LINK.test(input.trim()),
    async search(query, so = {}) {
      const body = await getJson({ id: AUDIUS_ID, label }, `${host}/tracks/search?${q({ query, limit: String(so.limit ?? opts.limit ?? 20) })}`, z.object({ data: z.array(TrackSchema) }), { fetch: opts.fetch, signal: so.signal });
      return body.data.filter(audiusStreamable).map(hitOf);
    },
    async resolve(input, ro = {}) {
      if (typeof input !== 'string') throw new SourceError('unsupported', `${label} opens links, not files`, AUDIUS_ID);
      const s = input.trim();
      const url = LINK.test(s) ? `${host}/resolve?${q({ url: s })}` : `${host}/tracks/${encodeURIComponent(s)}?${q({})}`;
      const body = await getJson({ id: AUDIUS_ID, label }, url, one, { fetch: opts.fetch, signal: ro.signal });
      return itemOf(body.data);
    },
    open: (item, h) => openOwnedAudio(item, h, { fetch: opts.fetch }),
  };
}
