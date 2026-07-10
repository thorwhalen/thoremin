/**
 * InstrumentsPanel — the top-right surface for the instruments flow. Closed, it is a
 * single instrument icon. Open, it shows one of three sub-views:
 *  - the LIST: the instrument library — each row selects & plays on click, shows its
 *    derived system tags + custom tags, a favorite star, and (on hover) a compact
 *    parametrization tooltip; the header carries a name filter, a sort control, and a
 *    "manage tags" entry (Instrument library UX epic #116: #112 starring/sort/filter,
 *    #113 tags column, #114 system tags, #115 tooltip);
 *  - the EDITOR: the dials-rendered {@link DialsControlsPanel} for the selected
 *    instrument, preceded by its Tags section and a "Set as default" toggle (default is
 *    now a per-instrument setting, decoupled from the star — #112), with a back arrow, an
 *    unsaved-edits dot, and a Save-with-confirm;
 *  - the TAG MANAGER: rename / re-emoji / delete custom tags ({@link TagManager}).
 *
 * Live edits flow into the dials store; the named instrument is only overwritten on an
 * explicit, confirmed Save. Library metadata (favorites, tags, associations) persists via
 * {@link useLibrary}; the single default pointer via {@link useInstruments}.
 */
import { useMemo, useState } from 'react';
import type { ProfileMeta } from '@zodal/dials-ui';
import { Music2, Settings, X, ArrowLeft, Star, Search, Tags, Check } from 'lucide-react';
import DialsControlsPanel from './DialsControlsPanel';
import { useInstruments } from './useInstruments';
import { useDialsSettings } from './useDialsSettings';
import { useLibrary } from '@/app/library/useLibrary';
import InstrumentTags from '@/app/library/InstrumentTags';
import TagsEditor from '@/app/library/TagsEditor';
import TagManager from '@/app/library/TagManager';
import { summaryLines } from '@/app/library/summarize';

const cardCls =
  'absolute right-3 top-3 flex max-h-[calc(100dvh-1.5rem)] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/60 backdrop-blur';

type SortMode = 'default' | 'star' | 'name';

/** Filter (by name substring) then sort the instrument list for display. Sort is stable,
 *  so 'star' keeps the underlying order within the starred / unstarred groups. */
function orderInstruments(
  list: ProfileMeta[],
  query: string,
  sort: SortMode,
  isStarred: (name: string) => boolean,
): ProfileMeta[] {
  const q = query.trim().toLowerCase();
  const filtered = q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;
  const arr = [...filtered];
  if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'star') arr.sort((a, b) => Number(isStarred(b.name)) - Number(isStarred(a.name)));
  return arr;
}

export default function InstrumentsPanel() {
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<'list' | 'editor' | 'tags'>('list');
  const [confirming, setConfirming] = useState(false);
  const [newName, setNewName] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('default');
  const { list, selected, ready, select, save, create, defaultName, setDefault } = useInstruments();
  const library = useLibrary(list);
  const shown = useMemo(
    () => orderInstruments(list, query, sort, library.starred),
    [list, query, sort, library.starred],
  );
  const { state } = useDialsSettings();
  const dirty = state.dirty.length > 0;

  const close = () => {
    setOpen(false);
    setView('list');
    setConfirming(false);
  };

  const doCreate = async () => {
    const n = newName.trim();
    if (!n) return;
    await create(n);
    setNewName('');
  };

  const openEditor = (name: string) => {
    select(name);
    setConfirming(false);
    setView('editor');
  };

  const doSave = async () => {
    if (selected) await save(selected);
    setConfirming(false);
  };

  /** The parametrization tooltip text for a row (issue #115), or a fallback hint. */
  const tooltipFor = (name: string): string => {
    const summary = library.summaryOf(name);
    if (!summary) return 'Click to play';
    return summaryLines(summary)
      .map((l) => `${l.label}: ${l.value}`)
      .join('\n');
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open instruments"
        className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/50 p-2.5 text-white/80 backdrop-blur transition hover:text-white"
      >
        <Music2 className="h-5 w-5" />
      </button>
    );
  }

  if (view === 'tags') {
    return (
      <div className={cardCls}>
        <TagManager api={library} onBack={() => setView('list')} onClose={close} />
      </div>
    );
  }

  if (view === 'editor') {
    const isDefault = selected != null && selected === defaultName;
    return (
      <div className={cardCls}>
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <button
            onClick={() => {
              setView('list');
              setConfirming(false);
            }}
            aria-label="Back to instruments"
            className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="flex flex-1 items-center gap-1.5 truncate text-[11px] font-bold uppercase tracking-widest text-white/70">
            <span className="truncate">{selected ?? 'Settings'}</span>
            {dirty && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="Unsaved edits" aria-label="Unsaved edits" />
            )}
          </span>
          <button
            onClick={() => setConfirming(true)}
            disabled={!dirty || !selected}
            className="rounded bg-white/10 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-white/80 transition hover:bg-white/20 hover:text-white disabled:opacity-40"
          >
            Save
          </button>
          <button
            onClick={close}
            aria-label="Close"
            className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {confirming && (
          <div className="flex items-center justify-between gap-2 border-b border-amber-300/20 bg-amber-300/5 px-3 py-1.5 text-[10px]">
            <span className="truncate text-amber-200/80">Override “{selected}” with these settings?</span>
            <span className="flex shrink-0 gap-1">
              <button
                onClick={() => void doSave()}
                className="rounded bg-emerald-500/80 px-2 py-0.5 font-bold text-black transition hover:bg-emerald-400"
              >
                Save
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded bg-white/10 px-2 py-0.5 text-white/80 transition hover:bg-white/20"
              >
                Cancel
              </button>
            </span>
          </div>
        )}
        <div className="space-y-4 overflow-auto p-4">
          {selected && (
            <div className="space-y-3">
              <button
                onClick={() => setDefault(selected)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${
                  isDefault
                    ? 'border-amber-300/40 bg-amber-300/10 text-amber-200'
                    : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                }`}
                title={isDefault ? 'This instrument opens on load — click to clear' : 'Open this instrument on load'}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    isDefault ? 'border-amber-300 bg-amber-300 text-black' : 'border-white/30'
                  }`}
                >
                  {isDefault && <Check className="h-3 w-3" />}
                </span>
                {isDefault ? 'Default instrument (opens on load)' : 'Set as default (opens on load)'}
              </button>
              <TagsEditor instrument={selected} api={library} />
            </div>
          )}
          <div className="border-t border-white/10 pt-3">
            <DialsControlsPanel />
          </div>
        </div>
      </div>
    );
  }

  // --- LIST view ---------------------------------------------------------------------
  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/70">
          <Music2 className="h-3.5 w-3.5" /> Instruments
        </span>
        <span className="flex items-center gap-1">
          <button
            onClick={() => setView('tags')}
            aria-label="Manage tags"
            title="Manage tags"
            className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <Tags className="h-4 w-4" />
          </button>
          <button
            onClick={close}
            aria-label="Close"
            className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </span>
      </div>
      <div className="overflow-auto p-2" aria-busy={!ready}>
        {!ready ? (
          <p className="px-2 py-3 text-[11px] text-white/40">Loading instruments…</p>
        ) : (
          <>
            {list.length > 3 && (
              <div className="mb-1.5 flex items-center gap-1.5">
                <div className="flex flex-1 items-center gap-1.5 rounded-lg bg-white/5 px-2">
                  <Search className="h-3 w-3 shrink-0 text-white/30" aria-hidden />
                  <input
                    className="w-full bg-transparent py-1.5 text-xs text-white/80 outline-none placeholder:text-white/30"
                    placeholder="Filter instruments…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Filter instruments"
                  />
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortMode)}
                  aria-label="Sort instruments"
                  className="rounded-lg bg-white/5 px-1.5 py-1.5 text-[11px] text-white/70 outline-none transition hover:bg-white/10"
                >
                  <option value="default">Sort: default</option>
                  <option value="star">Sort: starred</option>
                  <option value="name">Sort: name</option>
                </select>
              </div>
            )}
            <ul className="space-y-0.5">
              {shown.map((p) => {
                const isSel = p.name === selected;
                const isDefault = p.name === defaultName;
                const isStar = library.starred(p.name);
                return (
                  <li
                    key={p.name}
                    className={`rounded-lg ${isSel ? 'bg-white/10' : 'hover:bg-white/5'}`}
                  >
                    <div className="flex items-center gap-1">
                      <button
                        className={`flex flex-1 items-center gap-2 truncate px-2 py-2 text-left text-xs transition ${
                          isSel ? 'text-emerald-300' : 'text-white/80 hover:text-white'
                        }`}
                        title={tooltipFor(p.name)}
                        onClick={() => select(p.name)}
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${isSel ? 'bg-emerald-400' : 'bg-white/20'}`}
                          aria-hidden
                        />
                        <span className="truncate">{p.name}</span>
                        {isDefault && (
                          <span className="shrink-0 text-[9px] uppercase tracking-widest text-amber-300/70">(default)</span>
                        )}
                        {isSel && dirty && (
                          <span className="ml-1 shrink-0 text-[9px] uppercase tracking-widest text-amber-300/80">edited</span>
                        )}
                      </button>
                      <button
                        className={`rounded p-1.5 transition hover:bg-white/10 ${isStar ? 'text-amber-300' : 'text-white/25 hover:text-white/70'}`}
                        title={isStar ? 'Unfavorite' : 'Favorite'}
                        aria-label={isStar ? `Unfavorite ${p.name}` : `Favorite ${p.name}`}
                        aria-pressed={isStar}
                        onClick={() => library.toggleStar(p.name)}
                      >
                        <Star className={`h-3.5 w-3.5 ${isStar ? 'fill-current' : ''}`} />
                      </button>
                      <button
                        className="rounded p-2 text-white/40 transition hover:bg-white/10 hover:text-white"
                        title={`Edit ${p.name}`}
                        aria-label={`Edit ${p.name}`}
                        onClick={() => openEditor(p.name)}
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <InstrumentTags
                      systemTags={library.systemTagsOf(p.name)}
                      customTags={library.customTagsOf(p.name)}
                    />
                  </li>
                );
              })}
              {shown.length === 0 && (
                <li className="px-2 py-3 text-[11px] text-white/40">No instruments match “{query}”.</li>
              )}
            </ul>
          </>
        )}
        <p className="px-2 pb-2 pt-3 text-[10px] leading-relaxed text-white/40">
          Click a name to play it. ★ favorites an instrument; the gear opens its editor (tags,
          default, and settings — kept until you Save).
        </p>
        <div className="mt-1 flex gap-1 border-t border-white/10 px-2 pt-2">
          <input
            className="flex-1 rounded bg-white/10 px-2 py-1 text-xs outline-none placeholder:text-white/30 focus:bg-white/20"
            placeholder="Save current sound as…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doCreate();
            }}
          />
          <button
            className="rounded bg-white/10 px-2 py-1 text-xs text-white/80 transition hover:bg-white/20 disabled:opacity-40"
            disabled={!newName.trim()}
            onClick={() => void doCreate()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
