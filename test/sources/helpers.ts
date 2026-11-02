/**
 * Recorded responses for the source adapters (`test/fixtures/sources/`, provenance in its
 * `meta.json`) behind a fake `fetch` that answers by URL and records what was asked.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURES = join(__dirname, '..', 'fixtures', 'sources');
export const recorded = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

export type Route = (url: URL) => Response | undefined;

/** A fetch over `routes` (first that answers wins); anything else is a 404. */
export function fakeFetch(...routes: Route[]): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    for (const r of routes) {
      const res = r(url);
      if (res) return res;
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
