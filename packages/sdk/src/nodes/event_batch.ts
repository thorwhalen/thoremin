/**
 * One tick's batch of events, parsed one event at a time (#393 item 8).
 *
 * The air instruments' output nodes (`drum-out`, `pluck-out`) receive every hit or note of
 * a tick as one array. Parsing the array as a whole made one malformed event (a NaN `x`,
 * an infinite `strength`) silence every other event of that tick, with no trace. Here each
 * event stands on its own: a bad one is skipped and COUNTED, and only the first is logged,
 * because a node that keeps emitting a bad field would otherwise log at the frame rate.
 * The count stays on the parser (`skipped()`), the node's own record of what it refused.
 */
import type { z } from 'zod';

export interface EventBatchParser<T> {
  /** The well-formed events of `raw`, in order; the malformed ones skipped and counted. */
  parse(raw: readonly unknown[], log?: (msg: string) => void): T[];
  /** Events skipped since this parser was made. */
  skipped(): number;
}

/** A batch parser for `schema`'s events; `label` names the node in the one log line. */
export function createEventBatchParser<T>(schema: z.ZodType<T>, label: string): EventBatchParser<T> {
  let skipped = 0;
  return {
    parse(raw, log = console.warn) {
      const out: T[] = [];
      for (const event of raw) {
        const parsed = schema.safeParse(event);
        if (parsed.success) {
          out.push(parsed.data);
          continue;
        }
        if (skipped === 0) {
          const issue = parsed.error.issues[0];
          log(`[${label}] skipped a malformed event (${issue ? `${issue.path.join('.') || 'event'}: ${issue.message}` : 'invalid'}); later ones are counted, not logged.`);
        }
        skipped++;
      }
      return out;
    },
    skipped: () => skipped,
  };
}
