/**
 * A file the player chose on this device: decoded here, never uploaded (`pcm_local`).
 */
import { LICENCE_NOT_STATED } from '../licence';
import { OWNED_TRANSPORT, openOwnedAudio } from '../owned';
import { SourceError, type MediaItem, type SourceAdapter, type SourceInput, type TransportCapabilities } from '../types';

export const LOCAL_FILE_ID = 'file';

const isBlob = (v: unknown): v is Blob => typeof Blob !== 'undefined' && v instanceof Blob;

export function createLocalFileAdapter(opts: { transport?: TransportCapabilities } = {}): SourceAdapter {
  let n = 0;
  return {
    id: LOCAL_FILE_ID,
    label: 'File on this device',
    rights: 'pcm_local',
    capabilities: { search: false, links: true, transport: opts.transport ?? OWNED_TRANSPORT },
    matches: (input: SourceInput) => isBlob(input),
    async resolve(input): Promise<MediaItem> {
      if (!isBlob(input)) throw new SourceError('unsupported', 'not a file', LOCAL_FILE_ID);
      const name = (input as Blob & { name?: string }).name || 'song';
      return { source: LOCAL_FILE_ID, id: `${name}#${++n}`, title: name, licence: { name: LICENCE_NOT_STATED }, rights: 'pcm_local', media: { kind: 'blob', blob: input } };
    },
    open: (item, h) => openOwnedAudio(item, h),
  };
}
