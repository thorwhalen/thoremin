/**
 * The Song tool's Media search: one box to search the keyless catalogues (the Internet Archive,
 * Audius) or to paste a link (theirs, or any web address of an audio file). A hit that is an album
 * lists its tracks; choosing a track opens it through the sources (`../app/sources.ts`), where its
 * rights are checked and owned audio becomes the loaded song, beat tracked like a file.
 *
 * Every state shows at once: searching, the hits by source (and which source failed), the tracks of
 * the album being opened, the opening, and why something could not be opened.
 */
import { useRef, useState, type FormEvent } from 'react';
import type { MediaItem, SearchHit } from '@thoremin/sources';
import { providerKey, removeProviderKey, setProviderKey } from '@thoremin/sdk-ui/keys';
import { SOURCES, openInput, openMedia, resolveHit, searchReady } from '../app/sources';
import { formatTime } from './format';
import type { SongSourceItem } from '../nodes/song_player.schema';

type View =
  | { kind: 'idle' }
  | { kind: 'searching'; query: string; sources: string[] }
  | { kind: 'results'; query: string; hits: SearchHit[]; failed: { label: string; reason: string }[] }
  | { kind: 'tracks'; item: MediaItem; back: View }
  | { kind: 'opening'; title: string; back: View };

/** "Internet Archive" from an adapter id. */
const labelOf = (source: string): string => {
  try {
    return SOURCES.get(source).label;
  } catch {
    return source;
  }
};

/** "A, B and C". */
export const listWords = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Whether the box holds a link rather than words to search. */
export const isLink = (text: string): boolean => /^https?:\/\//i.test(text.trim());

/** What went wrong, in words, from whatever was thrown. */
const reasonOf = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'It could not be opened.');

/** An open a later choice replaced: not an error to show. */
const superseded = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'AbortError';

export default function MediaSearch({ onBusy }: { onBusy?: (busy: boolean) => void }) {
  const [text, setText] = useState('');
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may change the view: a slow search must not overwrite a newer one.
  const request = useRef(0);

  const open = async (title: string, run: () => Promise<unknown>, back: View) => {
    const id = ++request.current;
    setError(null);
    setView({ kind: 'opening', title, back });
    onBusy?.(true);
    try {
      await run();
      if (id === request.current) setView(back.kind === 'tracks' ? back.back : back);
    } catch (e) {
      if (id === request.current && !superseded(e)) {
        setError(reasonOf(e));
        setView(back);
      }
    } finally {
      onBusy?.(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    if (isLink(q)) {
      await open(q, () => openInput(q), { kind: 'idle' });
      return;
    }
    const id = ++request.current;
    setError(null);
    const ready = searchReady();
    setView({ kind: 'searching', query: q, sources: ready.map((a) => a.label) });
    const { hits, failures } = await SOURCES.search(q, { limit: 12, sources: ready.map((a) => a.id) });
    if (id !== request.current) return;
    setView({ kind: 'results', query: q, hits, failed: failures.map((f) => ({ label: labelOf(f.source), reason: f.error.message })) });
  };

  const pick = async (hit: SearchHit, back: View) => {
    const id = ++request.current;
    setError(null);
    setView({ kind: 'opening', title: hit.title, back });
    try {
      const item = await resolveHit(hit);
      if (id !== request.current) return;
      if (item.parts && item.parts.length > 1) {
        setView({ kind: 'tracks', item, back });
        return;
      }
      await open(item.title, () => openMedia(item), back);
    } catch (e) {
      if (id === request.current) {
        setError(reasonOf(e));
        setView(back);
      }
    }
  };

  const pickPart = (item: MediaItem, part: { id: string; title: string }, here: View) =>
    open(part.title, async () => openMedia(await SOURCES.resolveHit({ source: item.source, id: part.id, title: part.title })), here);

  return (
    <div className="space-y-2" data-testid="media-search">
      <form onSubmit={(e) => void onSubmit(e)} className="flex gap-1.5" role="search">
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search music or paste a link"
          aria-label="Search music or paste a link"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-sm text-white placeholder:text-white/40 focus:border-emerald-400/60 focus:outline-none"
        />
        <button type="submit" disabled={!text.trim()} className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-40">
          {isLink(text) ? 'Open' : 'Find'}
        </button>
      </form>
      {error && (
        <p className="text-[11px] text-amber-300/90" role="alert" data-testid="media-error">
          {error}
        </p>
      )}
      {view.kind === 'searching' && (
        <p className="text-[11px] text-white/60" aria-busy="true" data-testid="media-status">
          Searching {listWords(view.sources)} for "{view.query}"...
        </p>
      )}
      {view.kind === 'opening' && (
        <p className="text-[11px] text-white/60" aria-busy="true" data-testid="media-status">
          Opening {view.title}...
        </p>
      )}
      {view.kind === 'results' && <Results view={view} onPick={(h) => void pick(h, view)} />}
      {view.kind === 'tracks' && (
        <div className="space-y-1" data-testid="media-tracks">
          <div className="flex items-center justify-between gap-2 text-[11px] text-white/60">
            <span className="truncate">{view.item.parts!.length} tracks: choose one</span>
            <button onClick={() => setView(view.back)} className="shrink-0 text-white/50 hover:text-white/80">
              Back
            </button>
          </div>
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {view.item.parts!.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => void pickPart(view.item, p, view)}
                  className="w-full truncate rounded px-2 py-1.5 text-left text-xs text-white/85 hover:bg-white/10"
                >
                  {p.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <KeySettings />
    </div>
  );
}

/** The keys the adapters' searches need (YouTube's), each the player's own, kept on this device. */
function KeySettings() {
  const wanting = SOURCES.list().filter((a) => a.keySetting);
  if (!wanting.length) return null;
  return (
    <>
      {wanting.map((a) => (
        <KeySetting key={a.id} setting={a.keySetting!} />
      ))}
    </>
  );
}

function KeySetting({ setting }: { setting: NonNullable<ReturnType<typeof SOURCES.get>['keySetting']> }) {
  const [stored, setStored] = useState(() => providerKey(setting.provider) !== null);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = () => {
    const why = setProviderKey(setting.provider, draft);
    setProblem(why);
    if (!why) {
      setDraft('');
      setStored(true);
    }
  };
  return (
    <details className="rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-white/70" data-testid={`key-${setting.provider}`}>
      <summary className="cursor-pointer select-none">
        {setting.label}: {stored ? 'set' : 'not set'}
      </summary>
      <p className="mt-1 text-white/55">
        {setting.help}{' '}
        <a href={setting.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-white/80">
          Get a key
        </a>
      </p>
      <div className="mt-1.5 flex gap-1.5">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={stored ? 'Paste a new key to replace it' : 'Paste your key'}
          aria-label={setting.label}
          autoComplete="off"
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-white placeholder:text-white/35 focus:outline-none"
        />
        <button onClick={save} disabled={!draft.trim()} className="rounded bg-white/10 px-2 py-1 font-semibold text-white hover:bg-white/20 disabled:opacity-40">
          Save
        </button>
        {stored && (
          <button
            onClick={() => {
              removeProviderKey(setting.provider);
              setStored(false);
            }}
            className="rounded px-2 py-1 text-white/60 hover:text-white"
          >
            Remove
          </button>
        )}
      </div>
      {problem && <p className="mt-1 text-amber-300/90">{problem}</p>}
    </details>
  );
}

function Results({ view, onPick }: { view: Extract<View, { kind: 'results' }>; onPick: (hit: SearchHit) => void }) {
  if (!view.hits.length) {
    return (
      <p className="text-[11px] text-white/60" data-testid="media-status">
        {view.failed.length ? view.failed.map((f) => `${f.label}: ${f.reason}.`).join(' ') : `Nothing found for "${view.query}".`}
      </p>
    );
  }
  const sources = [...new Set(view.hits.map((h) => h.source))];
  return (
    <div className="max-h-72 space-y-2 overflow-y-auto" data-testid="media-results">
      {sources.map((source) => (
        <section key={source} aria-label={labelOf(source)}>
          <h3 className="px-1 text-[10px] uppercase tracking-widest text-white/40">{labelOf(source)}</h3>
          <ul className="space-y-0.5">
            {view.hits
              .filter((h) => h.source === source)
              .map((h) => (
                <li key={`${h.source}:${h.id}`}>
                  <button onClick={() => onPick(h)} className="w-full rounded px-2 py-1.5 text-left hover:bg-white/10" data-testid="media-hit">
                    <span className="block truncate text-xs text-white/90">{h.title}</span>
                    <span className="block truncate text-[10px] text-white/50">
                      {[h.artist, h.durationS ? formatTime(h.durationS) : null, h.licence?.name].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {view.failed.length > 0 && <p className="px-1 text-[10px] text-amber-300/80">{view.failed.map((f) => `${f.label}: ${f.reason}.`).join(' ')}</p>}
    </div>
  );
}

/** Where the loaded song came from, with its licence and a link to its page. */
export function SourceLine({ item }: { item: SongSourceItem | undefined }) {
  if (!item || item.source === 'file') return null;
  return (
    <div className="truncate text-[10px] text-white/50" data-testid="song-source">
      {labelOf(item.source)}
      {item.artist ? ` · ${item.artist}` : ''}
      {item.licence ? ` · licence: ${item.licence.name}` : ''}
      {item.pageUrl && (
        <>
          {' · '}
          <a href={item.pageUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-white/80">
            page
          </a>
        </>
      )}
    </div>
  );
}
