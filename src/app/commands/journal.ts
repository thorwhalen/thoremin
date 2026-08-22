/**
 * The command journal (#127) — telemetry and command export/replay, which are ONE
 * recorder read two ways.
 *
 * Every dispatch that reaches this middleware is appended to a bounded in-memory ring
 * buffer as `{command, params, t, ok}`. Read as a log it answers *which dials do people
 * actually touch* across all four dispatchers (panels, keyboard, AI assistant, gestures)
 * — the two of which (AI, gestures) nobody has data for. Read as a script it is a
 * replayable session: `replayJournal` re-dispatches it against a registry, which is the
 * substrate #82 wants for "an instrument as a replayable command sequence", and the
 * cheapest possible bug report ("here is the exact sequence that broke it").
 *
 * ## What it deliberately does NOT do
 *
 * - **No egress, no persistence.** The buffer lives in memory and dies with the tab.
 *   thoremin has no backend and a BYO-key posture; a telemetry feature that quietly
 *   started shipping a player's session somewhere would be a different product. Export
 *   is an explicit act by the person holding the tab (`toJSON()`).
 * - **It does not record failures out.** A rejected dispatch is recorded with `ok:false`
 *   and its error code, because *the failures are the interesting half* for a bug report.
 *   `replayable()` is what filters them back out for replay.
 * - **It cannot see a slider drag.** Continuous `type="range"` drags bypass the registry
 *   by design (Decision B — a write per pointer-move frame must not pay Zod validation
 *   and a promise). So the journal is a complete record of DISCRETE writes and an
 *   incomplete record of continuous ones. Replaying a session reproduces every discrete
 *   choice and none of the drags; that is a property to know, not a bug to fix here.
 */
import { isOk, type Registry } from 'acture';
import type { Dispatch, Middleware } from './middleware';

/** One recorded dispatch. `t` is epoch ms (injectable, so tests are deterministic). */
export interface JournalEntry {
  /** The dispatched command id, e.g. `dial.set`. */
  command: string;
  /** The params as dispatched. */
  params: unknown;
  /** Epoch ms at the moment the dispatch RESOLVED. */
  t: number;
  /** Whether the command succeeded. */
  ok: boolean;
  /** The error code when `ok` is false (e.g. `invalid_value`, `confirmation_required`). */
  code?: string;
  /** The dispatching surface, when the caller set one (`assistant`, …). */
  channel?: string;
}

/** The exported wire shape. Versioned so a later reader can tell eras apart. */
export interface JournalExport {
  version: 1;
  entries: JournalEntry[];
}

/** What a replay did. `failed` carries the entries that did not apply, with their index. */
export interface ReplayReport {
  /** How many entries were dispatched successfully. */
  applied: number;
  /** Entries whose re-dispatch failed, with their index in the replayed list. */
  failed: { index: number; command: string; code: string }[];
}

export interface Journal {
  /** The middleware to install on the registry. */
  middleware: Middleware;
  /** A snapshot copy of the buffer, oldest first. */
  entries(): JournalEntry[];
  /** The successful entries only — what `replayJournal` should be given. */
  replayable(): JournalEntry[];
  /** Drop everything recorded so far. */
  clear(): void;
  /** The versioned export envelope. */
  toJSON(): JournalExport;
}

/** Default ring-buffer size: long enough to cover a play session, small enough to ignore. */
const DEFAULT_LIMIT = 500;

/** The dispatch-context field the journal reads (the same one the confirmation gate uses). */
interface ChannelContext {
  channel?: string;
}

/**
 * Create a command journal. `limit` bounds the ring buffer (oldest entries are dropped);
 * `now` is injectable so tests don't depend on the wall clock.
 */
export function createJournal(options: { limit?: number; now?: () => number } = {}): Journal {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const now = options.now ?? (() => Date.now());
  const buffer: JournalEntry[] = [];

  const middleware: Middleware = (next) => async (command, params, context, ...rest) => {
    const result = await next(command, params, context, ...rest);
    const channel = (context as ChannelContext | undefined)?.channel;
    const ok = isOk(result as never);
    const entry: JournalEntry = { command, params, t: now(), ok };
    if (!ok) entry.code = (result as unknown as { error?: { code?: string } }).error?.code;
    if (channel) entry.channel = channel;
    buffer.push(entry);
    if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
    return result;
  };

  return {
    middleware,
    entries: () => buffer.slice(),
    replayable: () => buffer.filter((e) => e.ok),
    clear: () => {
      buffer.length = 0;
    },
    toJSON: () => ({ version: 1, entries: buffer.slice() }),
  };
}

/**
 * Re-dispatch a recorded sequence against a registry, in order.
 *
 * Sequential on purpose: the recorded order IS the meaning (a `dial.patch` that mirrors a
 * synced-hands voice edit depends on what the previous write left behind), so entries are
 * awaited one at a time rather than raced.
 *
 * NOTE: replay goes through the normal dispatch chain, so a replayed session is itself
 * journaled and does create undo entries. That is the honest behaviour — a replay is a
 * real sequence of real writes — and it is why `entries()` hands out a COPY: appending
 * to the live buffer while replaying a snapshot of it cannot feed itself.
 */
export async function replayJournal(
  entries: readonly JournalEntry[],
  registry: Registry,
  options: { context?: unknown } = {},
): Promise<ReplayReport> {
  // The one cast, here rather than at every call site: acture types `dispatch`'s context
  // as its own `Context`, which is narrower than the `unknown` a middleware forwards.
  const dispatch = registry.dispatch.bind(registry) as unknown as Dispatch;
  const report: ReplayReport = { applied: 0, failed: [] };
  for (const [index, entry] of entries.entries()) {
    const result = await dispatch(entry.command, entry.params, options.context);
    if (isOk(result as never)) {
      report.applied += 1;
    } else {
      const code = (result as unknown as { error?: { code?: string } }).error?.code ?? 'unknown';
      report.failed.push({ index, command: entry.command, code });
    }
  }
  return report;
}
