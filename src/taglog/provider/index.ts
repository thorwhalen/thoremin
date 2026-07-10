/**
 * taglog provider layer — persistence (tag sets) + the append-only event sink.
 *
 * Two responsibilities, one boundary: persist the last-used tag set + config via a
 * zodal `DataProvider<T>` (localStorage default), and drain live events to JSONL via
 * {@link TagEventSink}. Both sit behind stable contracts so storage is swappable
 * without touching the affordance core or the UI.
 */
export * from './sink';
export * from './defsStore';
