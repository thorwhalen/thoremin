/**
 * The score loader logic (#187 PR 3): a piece id resolves to a document through the
 * injected fetch (a demo) or the scores collection (a saved file), narrating the shared
 * load status, and the built-in id resolves to no document. The saved-scores round
 * trip goes through the real collection facade over an in-memory provider.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataProvider } from '@zodal/store';
import type { LoadStatus } from '@/lazy';
import { createScoreStore, DEMO_SCORES, loadScore, type ScoreRecord } from '@/score';
import { resolvePiece } from '@/app/resolvePiece';
import { BUILTIN_PIECE, DEFAULT_PIECE } from '@/settings/schema';

const PUBLIC = join(__dirname, '..', 'public');
const fetchBytes = async (url: string) => new Uint8Array(readFileSync(join(PUBLIC, url.replace(/^\//, ''))));

/** The smallest in-memory `DataProvider` the collection facade needs. */
function memoryProvider(): DataProvider<ScoreRecord> {
  const rows = new Map<string, ScoreRecord>();
  return {
    getList: async () => ({ data: [...rows.values()], total: rows.size }),
    getOne: async (id: string) => rows.get(id) ?? null,
    create: async (r: ScoreRecord) => (rows.set(r.id, r), r),
    update: async (id: string, r: ScoreRecord) => (rows.set(id, r), r),
    delete: async (id: string) => void rows.delete(id),
  } as unknown as DataProvider<ScoreRecord>;
}

describe('resolvePiece', () => {
  it('the built-in piece resolves to no document, ready', async () => {
    const phases: LoadStatus[] = [];
    const doc = await resolvePiece(BUILTIN_PIECE, { fetchBytes, baseUrl: '/', store: createScoreStore(memoryProvider()) }, (s) => phases.push(s));
    expect(doc).toBeNull();
    expect(phases[phases.length - 1].phase).toBe('ready');
  });

  it('the default piece is a shipped demo and loads through the lazy parser', async () => {
    expect(DEMO_SCORES.some((d) => d.id === DEFAULT_PIECE)).toBe(true);
    const phases: string[] = [];
    const doc = await resolvePiece(DEFAULT_PIECE, { fetchBytes, baseUrl: '/', store: createScoreStore(memoryProvider()) }, (s) => phases.push(s.phase));
    expect(doc).not.toBeNull();
    expect(doc!.parts.length).toBeGreaterThan(5);
    expect(phases).toEqual(['loading', 'ready']);
  });

  it('a saved score round-trips through the collection; a missing one is an error, not a crash', async () => {
    const store = createScoreStore(memoryProvider());
    const bytes = await fetchBytes(DEMO_SCORES[1].file);
    const parsed = await loadScore(bytes, DEMO_SCORES[1].file);
    const rec = await store.save('My quartet', parsed);
    expect(rec.id).toBe('my-quartet');
    const phases: string[] = [];
    const doc = await resolvePiece(rec.id, { fetchBytes, baseUrl: '/', store }, (s) => phases.push(s.phase));
    expect(doc?.parts.length).toBe(4);
    expect(phases[phases.length - 1]).toBe('ready');
    const missing: LoadStatus[] = [];
    const none = await resolvePiece('nope', { fetchBytes, baseUrl: '/', store }, (s) => missing.push(s));
    expect(none).toBeNull();
    expect(missing[missing.length - 1]).toMatchObject({ phase: 'error', reason: 'missing' });
  });

  it('a fetch failure is an error status with the message, never a throw', async () => {
    const failing = async () => {
      throw new Error('offline');
    };
    const out: LoadStatus[] = [];
    const doc = await resolvePiece(DEFAULT_PIECE, { fetchBytes: failing, baseUrl: '/', store: createScoreStore(memoryProvider()) }, (s) => out.push(s));
    expect(doc).toBeNull();
    expect(out[out.length - 1]).toMatchObject({ phase: 'error', message: 'offline' });
  });
});
