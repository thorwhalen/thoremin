/**
 * `loadScore` — bytes in, {@link ScoreDoc} out, the parser loaded on first use.
 *
 * The format is sniffed from the bytes (MIDI's `MThd`, a zip's `PK` for `.mxl`, an XML
 * `<`), with the file name as the tie-breaker, and the matching parser module is
 * `import()`ed at that moment and never before: neither `@tonejs/midi` nor `musicxml-io`
 * is in the main chunk, and a player who never loads a score never downloads a parser
 * (the lazy-loading rule, #188). A parse is a one-shot await, not a held resource, so
 * this is the dynamic-import seam `src/app/recording/formats.ts` uses rather than a
 * `lazyResource` state machine; what the UI gets is the same {@link LoadStatus}
 * vocabulary, from {@link loadScoreWithStatus}.
 *
 * Pure and Node-safe: no DOM, no fetch — `fetchDemo` takes the fetch function.
 */
import type { LoadStatus } from '@/lazy';
import type { DemoScore } from './library';
import type { ScoreDoc } from './schema';

export type ScoreFormat = 'midi' | 'musicxml';

/** What the bytes are, or null when neither parser would accept them. */
export function sniffFormat(bytes: Uint8Array, filename = ''): ScoreFormat | null {
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  if (head === 'MThd') return 'midi';
  if (head.startsWith('PK')) return 'musicxml'; // a compressed .mxl is a zip
  const text = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 512))).trimStart();
  if (text.startsWith('<')) return 'musicxml';
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'mid' || ext === 'midi') return 'midi';
  if (ext === 'mxl' || ext === 'musicxml' || ext === 'xml') return 'musicxml';
  return null;
}

/** The parser seam: injectable so tests and hosts can substitute; the default is the
 *  dynamic import of the sibling module. */
export interface ScoreParsers {
  midi: (bytes: Uint8Array, title?: string) => Promise<ScoreDoc>;
  musicxml: (bytes: Uint8Array, title?: string) => Promise<ScoreDoc>;
}

export const defaultParsers: ScoreParsers = {
  midi: async (bytes, title) => (await import('./midi')).midiToScoreDoc(bytes, title),
  musicxml: async (bytes, title) => (await import('./musicxml')).musicxmlToScoreDoc(bytes, title),
};

/** A title from a file name: strip the extension, turn separators into spaces. */
export function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

export async function loadScore(bytes: Uint8Array, filename = '', parsers: ScoreParsers = defaultParsers): Promise<ScoreDoc> {
  const format = sniffFormat(bytes, filename);
  if (!format) throw new Error(`Not a MIDI or MusicXML file${filename ? `: ${filename}` : ''}`);
  const title = filename ? titleFromFilename(filename) : undefined;
  return format === 'midi' ? parsers.midi(bytes, title) : parsers.musicxml(bytes, title);
}

/** Fetch and parse a shipped demo. `fetchFn` is injected (a Node test reads from disk). */
export async function fetchDemo(
  demo: DemoScore,
  fetchFn: (url: string) => Promise<Uint8Array>,
  baseUrl = '',
  parsers: ScoreParsers = defaultParsers,
): Promise<ScoreDoc> {
  const bytes = await fetchFn(baseUrl + demo.file);
  const doc = await loadScore(bytes, demo.file, parsers);
  return { ...doc, title: demo.title };
}

/**
 * The same load, narrated: `onStatus` receives the shared {@link LoadStatus} phases
 * (`loading` with the parser download, `ready`, `error` with a human message) so a
 * panel renders it with the one readout every heavy thing in the app uses.
 */
export async function loadScoreWithStatus(
  bytes: Uint8Array,
  filename: string,
  onStatus: (s: LoadStatus) => void,
  parsers: ScoreParsers = defaultParsers,
): Promise<ScoreDoc | null> {
  onStatus({ phase: 'loading', message: `Reading ${filename || 'the score'}...` });
  try {
    const doc = await loadScore(bytes, filename, parsers);
    onStatus({ phase: 'ready', message: `${doc.title}: ${doc.parts.length} parts, ${Math.round(doc.lengthBeats)} beats` });
    return doc;
  } catch (err) {
    onStatus({ phase: 'error', reason: 'parse', message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
