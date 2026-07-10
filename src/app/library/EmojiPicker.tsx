/**
 * EmojiPicker — pick a tag's emoji by text search over the curated pool (issue #113):
 * "type cat, click the cat". A search box filters {@link searchEmoji}; an empty query
 * shows the whole pool as a scrollable grid. Fully client-side (no dataset fetch), so it
 * opens instantly. Used by the tag manager to (re)assign a tag's glyph.
 */
import { useMemo, useState } from 'react';
import { searchEmoji } from './emoji';

export default function EmojiPicker({
  value,
  onPick,
}: {
  value?: string;
  onPick: (emoji: string) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchEmoji(query), [query]);

  return (
    <div className="rounded-lg border border-white/10 bg-black/40 p-2">
      <input
        autoFocus
        className="mb-2 w-full rounded bg-white/10 px-2 py-1 text-xs text-white/80 outline-none placeholder:text-white/30 focus:bg-white/20"
        placeholder="Search emoji (e.g. cat, fire, star)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search emoji"
      />
      {results.length === 0 ? (
        <p className="px-1 py-2 text-[11px] text-white/40">No emoji match “{query}”.</p>
      ) : (
        <div className="grid max-h-40 grid-cols-8 gap-0.5 overflow-auto">
          {results.map((e) => (
            <button
              key={e.char}
              type="button"
              onClick={() => onPick(e.char)}
              title={e.keywords[0]}
              aria-label={`Pick ${e.keywords[0]}`}
              className={`rounded p-1 text-lg leading-none transition hover:bg-white/15 ${
                e.char === value ? 'bg-white/20 ring-1 ring-emerald-400/60' : ''
              }`}
            >
              {e.char}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
