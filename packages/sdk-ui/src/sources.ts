/**
 * Source adapters a build contributes to the Song tool (a provider only one build ships, like the
 * lab build's streaming embeds): an extension adds them on mount, the song slice reads them. The
 * adapters themselves are `@thoremin/sources` ones.
 */
import type { SourceAdapter } from '@thoremin/sources/types';

let contributed: readonly SourceAdapter[] = [];
const listeners = new Set<() => void>();

/** Add adapters; returns the removal. */
export function contributeSourceAdapters(adapters: readonly SourceAdapter[]): () => void {
  contributed = [...contributed, ...adapters];
  listeners.forEach((l) => l());
  return () => {
    contributed = contributed.filter((a) => !adapters.includes(a));
    listeners.forEach((l) => l());
  };
}

/** The adapters contributed so far, in order. */
export function contributedSourceAdapters(): readonly SourceAdapter[] {
  return contributed;
}

/** Called when the contributed adapters change; returns the unsubscribe. */
export function onSourceAdaptersChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
