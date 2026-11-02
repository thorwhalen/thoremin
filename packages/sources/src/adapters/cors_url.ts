/**
 * Any web address of an audio file. The browser lets the page read it only when its host allows
 * other pages to (CORS); otherwise opening it says so. Registered last: every other adapter's links
 * are tried first.
 */
import { LICENCE_NOT_STATED } from '../licence';
import { OWNED_TRANSPORT, openOwnedAudio } from '../owned';
import { SourceError, type MediaItem, type SourceAdapter, type SourceInput, type TransportCapabilities } from '../types';

export const CORS_URL_ID = 'url';

const LINK = /^https?:\/\/[^\s]+$/i;

/** The file name in a URL's path, decoded, without its extension; the host when there is none. */
export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return last.replace(/\.[a-z0-9]+$/i, '') || u.hostname;
  } catch {
    return url;
  }
}

export function createCorsUrlAdapter(opts: { fetch?: typeof fetch; transport?: TransportCapabilities } = {}): SourceAdapter {
  return {
    id: CORS_URL_ID,
    label: 'Web address',
    rights: 'pcm_local',
    capabilities: { search: false, links: true, transport: opts.transport ?? OWNED_TRANSPORT },
    matches: (input: SourceInput) => typeof input === 'string' && LINK.test(input.trim()),
    async resolve(input): Promise<MediaItem> {
      if (typeof input !== 'string' || !LINK.test(input.trim())) throw new SourceError('unsupported', 'not a web address', CORS_URL_ID);
      const url = input.trim();
      return { source: CORS_URL_ID, id: url, title: titleFromUrl(url), pageUrl: url, licence: { name: LICENCE_NOT_STATED }, rights: 'pcm_local', media: { kind: 'url', url } };
    },
    open: (item, h) => openOwnedAudio(item, h, { fetch: opts.fetch }),
  };
}
