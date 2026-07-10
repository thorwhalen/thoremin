/**
 * taglog provider layer — the JSONL event sink + the zodal tag-set persistence.
 * The sink is pure (strings in/out); the tag-set provider is exercised over the real
 * `@zodal/store-localstorage` adapter with a Node localStorage shim, proving the
 * zodal-way persistence actually works end-to-end.
 */
// localStorage shim for the node test env (matches the repo's other browser-code tests).
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

import { describe, it, expect } from 'vitest';
import { TagEventSink } from '@/taglog/provider/sink';
import {
  createTagSetProvider,
  loadLastUsed,
  saveTagSet,
  parseTagSet,
  TagSetDocSchema,
} from '@/taglog/provider/defsStore';
import type { AnchorRecord, EdgeEvent } from '@/taglog/affordances';

describe('TagEventSink', () => {
  const anchor: AnchorRecord = {
    anchor: true,
    t: 0,
    clock: 'media',
    wallClockISO: '2026-07-10T00:00:00.000Z',
    recStartPerf: 1234.5,
    session: 'sess_1',
    schema: 'thoremin.tags/1',
  };
  const open: EdgeEvent = { tag: 'pluck', kind: 'interval', status: 'open', t: 5, tCorrected: 7, seq: 0, clock: 'media', src: 'key' };
  const point: EdgeEvent = { tag: 'boom', kind: 'point', status: 'point', t: 8, tCorrected: 8, seq: 1, clock: 'media', src: 'click' };

  it('writes the anchor first, then codec-serialized rows, and drains to JSONL', () => {
    const sink = new TagEventSink('statusEnum');
    expect(sink.isEmpty).toBe(true);
    sink.writeAnchor(anchor);
    sink.append([open, point]);
    expect(sink.count).toBe(3); // anchor + 2 rows
    const out = sink.drain();
    const lines = out.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ anchor: true, schema: 'thoremin.tags/1' });
    expect(lines[1]).toMatchObject({ status: 'open', tag: 'pluck', t: 5 });
    expect(lines[2]).toMatchObject({ status: 'point', tag: 'boom' });
    expect(sink.drain()).toBe(''); // cleared
  });

  it('honors the pointPair codec (a point becomes two rows)', () => {
    const sink = new TagEventSink('pointPair');
    sink.append([point]);
    expect(sink.count).toBe(2);
    const rows = sink.drain().trim().split('\n').map((l) => JSON.parse(l));
    expect(rows.map((r) => r.status)).toEqual(['open', 'close']);
  });
});

describe('parseTagSet', () => {
  it('heals a partial blob to a valid doc', () => {
    const doc = parseTagSet({ id: 'x', tags: [{ id: 'a', label: 'A' }] });
    expect(doc.tags[0]).toMatchObject({ id: 'a', kind: 'interval', number: null });
    expect(doc.config.exclusivity).toBe('off');
  });
});

describe('tag-set provider (zodal localStorage)', () => {
  const KEY = 'taglog.test.tagsets';
  const mk = (id: string, updatedAt: number) =>
    TagSetDocSchema.parse({ id, name: id, tags: [{ id: 't1', label: 'T1' }], updatedAt });

  it('persists tag sets and pre-seeds the most-recently-updated one', async () => {
    localStorage.removeItem(KEY);
    const provider = createTagSetProvider(KEY);
    await saveTagSet(provider, mk('old', 100));
    await saveTagSet(provider, mk('new', 200));
    const last = await loadLastUsed(provider);
    expect(last?.id).toBe('new');
  });

  it('saveTagSet upserts (update in place, no duplicate)', async () => {
    localStorage.removeItem(KEY);
    const provider = createTagSetProvider(KEY);
    await saveTagSet(provider, mk('s', 100));
    await saveTagSet(provider, { ...mk('s', 300), name: 'renamed' });
    const { data, total } = await provider.getList({});
    expect(total).toBe(1);
    expect(data[0].name).toBe('renamed');
  });

  it('loadLastUsed returns null when nothing is saved', async () => {
    localStorage.removeItem(KEY);
    expect(await loadLastUsed(createTagSetProvider(KEY))).toBeNull();
  });
});
