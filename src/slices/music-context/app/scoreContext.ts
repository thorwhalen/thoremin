/**
 * The score producer, live: whenever the loaded score changes (the conductor's `scoreDoc`), the old
 * score's layer is withdrawn at once, and the new one's timeline is made (or read from the device
 * cache, by the document's content key) and published as the `score` layer, played by the
 * conductor's clock. A load overtaken by a newer score is dropped.
 */
import { controls } from '@thoremin/sdk-ui/host';
import { contentKey, produceCached, type ContextCache } from '@thoremin/sdk/context/cache';
import { scoreProducer } from '@thoremin/sdk/context/producer';
import { readScoreDoc } from '@thoremin/sdk/score/prepare';
import { createContextCache } from './cache';
import { setLayer } from './active';

/** The loaded score's hot-store field (the conductor slice's transient). */
export const SCORE_DOC_FIELD = 'scoreDoc';

/** Start following the loaded score; returns the stop. */
export function startScoreContext({ cache = createContextCache() }: { cache?: ContextCache } = {}): () => void {
  const producer = scoreProducer();
  let last: unknown = undefined;
  let generation = 0;
  const apply = (): void => {
    const raw = controls().get()[SCORE_DOC_FIELD] ?? null;
    if (raw === last) return;
    last = raw;
    const mine = ++generation;
    // The old score's timeline goes at once: the conductor plays the new score from now, and its
    // beats must not be read through the old score's keys while the new timeline is made.
    setLayer('score', null);
    const doc = readScoreDoc(raw);
    if (!doc) return;
    void (async () => {
      const key = await contentKey(JSON.stringify(doc));
      const context = await produceCached(producer, doc, key, cache);
      if (mine === generation) setLayer('score', { context, clock: 'conductor' });
    })().catch(() => {
      if (mine === generation) setLayer('score', null);
    });
  };
  apply();
  const unsubscribe = controls().subscribe(apply);
  return () => {
    unsubscribe();
    generation++;
    setLayer('score', null);
  };
}
