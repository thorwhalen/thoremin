/**
 * The adapters' one JSON fetch: an HTTP error, an unreachable host and a body that is not the
 * shape the adapter reads each raise a {@link SourceError} naming the source.
 */
import type { z } from 'zod';
import { SourceError } from '../types';

export async function getJson<T>(src: { id: string; label: string }, url: string, schema: z.ZodType<T>, opts: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<T> {
  const { id: source, label } = src;
  const doFetch = opts.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(url, { signal: opts.signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new SourceError('network', `${label} could not be reached`, source);
  }
  if (res.status === 404) throw new SourceError('not-found', `${label} has no such item`, source);
  if (!res.ok) throw new SourceError('network', `${label} answered HTTP ${res.status}`, source);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SourceError('bad-response', `${label} answered something that is not JSON`, source);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new SourceError('bad-response', `${label} answered in a shape this version does not read: ${parsed.error.issues[0]?.message ?? 'invalid'}`, source);
  return parsed.data;
}
