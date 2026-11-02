/**
 * A provider's player as a plain iframe with no remote control (Deezer, Suno, Bandcamp, Apple
 * Music): it plays from its own buttons, and reports nothing, so its capabilities say so.
 */
import { NO_CONTROL } from '../embed';
import type { EmbedEvent, EmbedPlayer, MediaItem } from '../types';

export function createIframePlayer(container: HTMLElement, item: MediaItem): EmbedPlayer {
  if (item.media.kind !== 'embed') throw new Error(`${item.title} is not an embed`);
  const frame = container.ownerDocument.createElement('iframe');
  frame.src = item.media.embedUrl;
  frame.title = item.title;
  frame.allow = 'autoplay; encrypted-media; clipboard-write';
  frame.style.border = '0';
  frame.style.width = '100%';
  frame.style.height = '100%';
  const ready = new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve();
    frame.onerror = () => reject(new Error(`${item.title}'s player could not load`));
  });
  container.appendChild(frame);
  const none = new Set<() => void>();
  return {
    capabilities: NO_CONTROL,
    ready,
    play() {},
    pause() {},
    position: () => 0,
    durationS: () => item.durationS ?? 0,
    playing: () => false,
    ended: () => false,
    on: (_e: EmbedEvent, l: () => void) => {
      none.add(l);
      return () => none.delete(l);
    },
    dispose: () => frame.remove(),
  };
}
