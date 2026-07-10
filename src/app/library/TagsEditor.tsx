/**
 * TagsEditor — the instrument editor's Tags section (issue #113): the custom tags applied
 * to the current instrument as removable chips, plus a comma-separated input that adds
 * tags. While typing, existing tags matching the current token are offered as autosuggest;
 * a typed label with no match creates a new tag (auto-assigned an emoji) on commit
 * (Enter or comma). System tags are shown read-only for context but are not editable here.
 */
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { LibraryApi } from './useLibrary';
import { normalizeLabel } from './model';

export default function TagsEditor({ instrument, api }: { instrument: string; api: LibraryApi }) {
  const [input, setInput] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1); // highlighted autosuggest row (-1 = none)
  const applied = api.customTagsOf(instrument);
  const appliedIds = useMemo(() => new Set(applied.map((t) => t.id)), [applied]);
  const systemTags = api.systemTagsOf(instrument);

  // Autosuggest on the segment after the last comma (the token being typed).
  const token = input.slice(input.lastIndexOf(',') + 1).trim();
  const suggestions = useMemo(() => {
    const q = normalizeLabel(token);
    if (!q) return [];
    return api.tags
      .filter((t) => !appliedIds.has(t.id) && normalizeLabel(t.label).includes(q))
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, api.tags, appliedIds]);

  const commit = async (csv: string) => {
    const text = csv.trim();
    if (!text) return;
    setInput('');
    await api.addTags(instrument, text);
  };

  const pickSuggestion = async (label: string) => {
    // Replace the in-progress token with the chosen label, then commit the whole input.
    const head = input.slice(0, input.lastIndexOf(',') + 1);
    await commit(`${head}${label}`);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/50">
        Tags
      </div>

      {systemTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {systemTags.map((t) => (
            <span
              key={t.id}
              title={t.label}
              className="inline-flex items-center gap-1 rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-white/45"
            >
              <span>{t.emoji}</span>
              <span className="truncate">{t.label}</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {applied.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/80"
          >
            <span>{t.emoji}</span>
            <span>{t.label}</span>
            <button
              type="button"
              onClick={() => api.removeTag(instrument, t.id)}
              aria-label={`Remove tag ${t.label}`}
              className="rounded-full p-0.5 text-white/40 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {applied.length === 0 && <span className="text-[11px] text-white/30">No tags yet.</span>}
      </div>

      <div className="relative">
        <input
          className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white/80 outline-none placeholder:text-white/30 focus:bg-white/20"
          placeholder="Add tags (comma-separated)…"
          value={input}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls="tag-suggestions"
          aria-activedescendant={activeIndex >= 0 ? `tag-suggestion-${activeIndex}` : undefined}
          onChange={(e) => {
            setInput(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && suggestions.length > 0) {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, -1));
            } else if (e.key === 'Escape') {
              setActiveIndex(-1);
            } else if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              // Enter accepts the highlighted suggestion (keyboard pick); otherwise Enter
              // and comma both commit the typed token(s) as-is (a new tag if unmatched).
              if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < suggestions.length) {
                void pickSuggestion(suggestions[activeIndex].label);
              } else {
                void commit(input);
              }
              setActiveIndex(-1);
            }
          }}
          aria-label="Add tags"
        />
        {suggestions.length > 0 && (
          <ul
            id="tag-suggestions"
            role="listbox"
            className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-white/10 bg-black/80 backdrop-blur"
          >
            {suggestions.map((t, i) => (
              <li key={t.id} id={`tag-suggestion-${i}`} role="option" aria-selected={i === activeIndex}>
                <button
                  type="button"
                  onClick={() => void pickSuggestion(t.label)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-white/80 transition ${
                    i === activeIndex ? 'bg-white/15' : 'hover:bg-white/10'
                  }`}
                >
                  <span>{t.emoji}</span>
                  <span className="truncate">{t.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
