/**
 * The shipped adapters, in link order (the catch-all web address last).
 */
import type { SourceAdapter, TransportCapabilities } from '../types';
import { createLocalFileAdapter } from './local_file';
import { createInternetArchiveAdapter } from './internet_archive';
import { createAudiusAdapter } from './audius';
import { createCorsUrlAdapter } from './cors_url';

export { createLocalFileAdapter, LOCAL_FILE_ID } from './local_file';
export { createInternetArchiveAdapter, INTERNET_ARCHIVE_ID } from './internet_archive';
export { createAudiusAdapter, AUDIUS_ID } from './audius';
export { createCorsUrlAdapter, CORS_URL_ID } from './cors_url';

export interface DefaultAdapterOptions {
  fetch?: typeof fetch;
  /** The owned-audio transport the app's song player offers. */
  transport?: TransportCapabilities;
}

/** The v1 adapters: a file, the Internet Archive, Audius, then any web address. */
export function defaultAdapters(opts: DefaultAdapterOptions = {}): SourceAdapter[] {
  return [
    createLocalFileAdapter({ transport: opts.transport }),
    createInternetArchiveAdapter({ fetch: opts.fetch, transport: opts.transport }),
    createAudiusAdapter({ fetch: opts.fetch, transport: opts.transport }),
    createCorsUrlAdapter({ fetch: opts.fetch, transport: opts.transport }),
  ];
}
