/**
 * ToolsLauncher — the list of every shell tool, opened from the bar's Tools button or `T`
 * (Round 4, Discussion #271, option B).
 *
 * It is the RENDERING of the tools collection (`toolsCollection.ts`), and it takes what it
 * shows from the collection's declared affordances rather than knowing them itself: the
 * search box's placeholder from `affordances.search`, the sections from
 * `affordances.groupBy`, what a search matches from the provider over the fields the
 * collection declares searchable (via `toolsCatalog.ts`). Each row opens its tool, and
 * carries the pin that decides whether the tool also keeps a button in the bar — the
 * player's choice, persisted through the pins' `DataProvider`.
 *
 * Opening a tool closes the launcher; Escape closes it; the search box has focus on open.
 *
 * The row and section rendering is a temporary in-repo stand-in for zodal's collection-view
 * renderer (i2mint/zodal#14; migration tracked in thorwhalen/thoremin#283).
 */
import { useEffect, useState } from 'react';
import { Pin, PinOff, Search, X } from 'lucide-react';
import { TOOL_GROUPS, type Tool } from './tools';
import { TOOL_ICONS } from './toolIcons';
import { isPinned, toolsCollection } from './toolsCollection';
import { searchTools, useToolsCatalog } from './toolsCatalog';
import { useToolPins } from './toolPins';
import { useTools } from './toolsStore';

const search = toolsCollection.affordances.search;
const PLACEHOLDER = (typeof search === 'object' && search.placeholder) || 'Search';
const groupBy = toolsCollection.affordances.groupBy;
const GROUP_FIELD = ((typeof groupBy === 'object' && groupBy.defaultField) || 'group') as keyof Tool;

function ToolRow({ tool }: { tool: Tool }) {
  const pinned = useToolPins((s) => isPinned(tool, s.choices));
  const setPinned = useToolPins((s) => s.setPinned);
  const Icon = TOOL_ICONS[tool.id];

  const body = (
    <>
      <span className="mt-0.5 text-white/60">{Icon && <Icon className="h-4 w-4" aria-hidden />}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs text-white/90">
          {tool.label}
          {tool.hotkey && (
            <kbd className="rounded bg-white/10 px-1 py-px font-mono text-[9px] text-white/50">{tool.hotkey}</kbd>
          )}
        </span>
        <span className="block text-[10px] leading-snug text-white/45">{tool.description}</span>
      </span>
    </>
  );
  const rowCls = 'flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5';

  return (
    <li className="flex items-start gap-1" data-launcher-tool={tool.id}>
      {tool.kind === 'link' ? (
        <a href={tool.href} className={rowCls} onClick={() => useTools.getState().closeLauncher()}>
          {body}
        </a>
      ) : (
        <button type="button" className={rowCls} onClick={() => useTools.getState().openTool(tool.id)}>
          {body}
        </button>
      )}
      <button
        type="button"
        onClick={() => setPinned(tool.id, !pinned)}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${tool.label} from the bar` : `Pin ${tool.label} to the bar`}
        title={pinned ? 'Pinned: it has a button in the bar' : 'Pin it to keep a button in the bar'}
        className={`mt-1 rounded p-1.5 transition hover:bg-white/10 ${pinned ? 'text-emerald-400' : 'text-white/25 hover:text-white/60'}`}
      >
        {pinned ? <Pin className="h-3.5 w-3.5" aria-hidden /> : <PinOff className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </li>
  );
}

export default function ToolsLauncher() {
  const open = useTools((s) => s.launcherOpen);
  const items = useToolsCatalog((s) => s.items);
  const loading = useToolsCatalog((s) => s.loading);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) void searchTools(query);
  }, [open, query]);

  // A fresh launcher each time: no stale search from the last visit.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) useTools.getState().closeLauncher();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const sections = TOOL_GROUPS.map((g) => ({ ...g, tools: items.filter((t) => t[GROUP_FIELD] === g.id) })).filter(
    (g) => g.tools.length > 0,
  );

  return (
    <div
      role="dialog"
      aria-label="Tools"
      data-tools-launcher-sheet
      className="shell-tool-panel absolute left-3 z-50 flex w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/80 backdrop-blur"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={PLACEHOLDER}
          aria-label="Find a tool"
          className="w-full bg-transparent py-1 text-xs text-white/85 outline-none placeholder:text-white/30"
        />
        <button
          type="button"
          onClick={() => useTools.getState().closeLauncher()}
          aria-label="Close the Tools list"
          className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="overflow-auto p-1.5">
        {sections.map((g) => (
          <section key={g.id} role="group" aria-label={g.label} className="mb-1">
            <h3 className="px-2 pb-0.5 pt-1.5 text-[9px] uppercase tracking-widest text-white/40">
              {g.label}
              {g.hint && <span className="normal-case tracking-normal text-white/30"> · {g.hint}</span>}
            </h3>
            <ul>
              {g.tools.map((t) => (
                <ToolRow key={t.id} tool={t} />
              ))}
            </ul>
          </section>
        ))}
        {sections.length === 0 && query && !loading && (
          <p className="px-2 py-3 text-[11px] text-white/40">No tool matches “{query}”.</p>
        )}
      </div>
      <p className="border-t border-white/10 px-3 py-1.5 text-[9px] text-white/35">
        Pinned tools keep a button in the bar.
      </p>
    </div>
  );
}
