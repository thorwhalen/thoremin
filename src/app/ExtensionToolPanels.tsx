/**
 * The frame every extension tool opens in (#330): the shell draws it (title, strapline, close)
 * like its own tool panels, and mounts the extension's content only while that tool is the
 * open one. For a lazy extension the content is a placeholder that fetches the extension's
 * React half on that first open, so a cold load fetches none of it.
 */
import { Puzzle, X } from 'lucide-react';
import { useTools } from './toolsStore';
import { UI_CONTRIBUTIONS } from './host/contributions';
import { shellToolById } from './shellTools';
import { TOOL_ICONS } from './toolIcons';

export default function ExtensionToolPanels() {
  const open = useTools((s) => s.open);
  const close = useTools((s) => s.close);
  const entry = UI_CONTRIBUTIONS.toolPanels.find((p) => p.id === open);
  if (!entry) return null;
  const tool = shellToolById(entry.id);
  const label = tool?.label ?? entry.id;
  const { Panel } = entry;
  const Icon = TOOL_ICONS[entry.id] ?? Puzzle;
  return (
    <div
      data-tool={entry.id}
      className="shell-tool-panel absolute left-3 z-40 flex w-[min(34rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/70 backdrop-blur"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-white/70">{label}</span>
        <button
          type="button"
          onClick={close}
          aria-label={`Close the ${label} panel`}
          className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 overflow-auto p-4">
        {tool && <p className="text-[10px] uppercase tracking-widest text-emerald-500/70">{tool.description}</p>}
        <Panel close={close} />
      </div>
    </div>
  );
}
