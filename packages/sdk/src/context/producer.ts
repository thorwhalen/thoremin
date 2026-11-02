/**
 * The producer seam: anything that turns an input (a score, the player's entries, a decoded
 * recording) into a {@link MusicalContext}. A producer names the source it stands for, so a host
 * can rank what it has; the score's is exact, the player's overrides it, an estimate from audio
 * (a later producer behind this same seam) is ranked below both.
 *
 * Pure: the contract and the stock score producer.
 */
import type { ScoreDoc } from '../score/schema';
import { contextFromScore, type ScoreContextOptions } from './from_score';
import type { ContextSource, MusicalContext } from './schema';

export interface ContextProducer<I> {
  /** A stable name (what an analyzer list or a cache entry can be traced to). */
  readonly id: string;
  readonly source: ContextSource;
  produce(input: I, options?: { contentKey?: string }): MusicalContext | Promise<MusicalContext>;
}

/** The score producer: exact, synchronous. */
export function scoreProducer(defaults: Omit<ScoreContextOptions, 'contentKey'> = {}): ContextProducer<ScoreDoc> {
  return {
    id: 'score',
    source: 'score',
    produce: (doc, options) => contextFromScore(doc, { ...defaults, ...(options?.contentKey !== undefined ? { contentKey: options.contentKey } : {}) }),
  };
}
