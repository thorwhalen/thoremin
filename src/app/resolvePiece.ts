/**
 * Resolving the conductor's `piece` to a {@link ScoreDoc} (#187 PR 3) — the logic the
 * `ScoreLoader` component runs, kept React-free and dependency-injected so it is
 * testable in plain Node (and in its own file: a `scoreLoader.ts` next to
 * `ScoreLoader.tsx` collides on a case-insensitive filesystem, which is how the first
 * build of this PR failed): `fetchBytes` (a demo file), the scores collection (a saved
 * file), and the status callback (the shared `LoadStatus` vocabulary) are all passed
 * in.
 *
 * Three kinds of piece id: {@link BUILTIN_PIECE} (no document; the `score` node plays
 * its demo scale), a shipped demo's id (`src/score/library.ts`, fetched from
 * `public/scores/` and parsed on first use, never persisted), and a saved score's id
 * (the `scores` collection). The parsers are loaded lazily by `loadScore`, so a player
 * who never enables conducting never downloads one.
 */
import type { LoadStatus } from '@/lazy';
import { BUILTIN_PIECE } from '@/settings/schema';
import { demoById, fetchDemo, type ScoreDoc, type ScoreStore } from '@/score';

export interface ScoreLoaderDeps {
  /** Fetch a file by URL (relative to `baseUrl`) as bytes. */
  fetchBytes: (url: string) => Promise<Uint8Array>;
  /** The app's base URL (Vite's `import.meta.env.BASE_URL`). */
  baseUrl: string;
  /** The player's saved scores. */
  store: ScoreStore;
}

/** The document for `piece`, narrating the shared status phases. `null` for the
 *  built-in piece (ready) and on failure (error). */
export async function resolvePiece(piece: string, deps: ScoreLoaderDeps, onStatus: (s: LoadStatus) => void): Promise<ScoreDoc | null> {
  if (!piece || piece === BUILTIN_PIECE) {
    onStatus({ phase: 'ready', message: 'Built-in scale' });
    return null;
  }
  const demo = demoById(piece);
  try {
    if (demo) {
      onStatus({ phase: 'loading', message: `Loading ${demo.title}...` });
      const doc = await fetchDemo(demo, deps.fetchBytes, deps.baseUrl);
      onStatus({ phase: 'ready', message: `${doc.title}: ${doc.parts.length} parts, ${Math.round(doc.lengthBeats)} beats` });
      return doc;
    }
    onStatus({ phase: 'loading', message: 'Loading the saved score...' });
    const rec = await deps.store.load(piece);
    if (!rec) {
      onStatus({ phase: 'error', reason: 'missing', message: 'That saved score is gone; pick another piece.' });
      return null;
    }
    onStatus({ phase: 'ready', message: `${rec.doc.title}: ${rec.doc.parts.length} parts, ${Math.round(rec.doc.lengthBeats)} beats` });
    return rec.doc;
  } catch (err) {
    onStatus({ phase: 'error', reason: 'load', message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** The browser's fetch, as bytes. */
export async function fetchBytesFromUrl(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch ${url} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
