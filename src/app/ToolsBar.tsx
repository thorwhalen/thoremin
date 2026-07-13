/**
 * ToolsBar — the bottom-left strip of shell affordances, one button per {@link TOOLS}
 * entry (#136).
 *
 * This is the answer to "how does a player find the Feature Lab / the command palette",
 * and the reason both were invisible: nothing in the shell ever mentioned them. Every
 * button carries a visible TEXT label, not just an icon — the AI assistant's unlabelled
 * robot icon and the palette's hotkey-only affordance are exactly the two things a first
 * time player never discovers.
 *
 * Purely presentational: it reads {@link useTools} for which tool is open and toggles it.
 * Each tool's actual surface mounts itself in App and renders when it is the open one.
 */
import { FlaskConical, Command, BookOpen, type LucideIcon } from 'lucide-react';
import { TOOLS, type Tool } from './tools';
import { useTools } from './toolsStore';
import VersionBadge from './VersionBadge';

/** The icon per tool id. Kept here (not in `tools.ts`) so the registry stays React-free
 *  and importable from plain Node tests. A tool with no icon still renders — label-only
 *  is fine, an icon-only button is not. */
const ICONS: Record<string, LucideIcon> = {
  lab: FlaskConical,
  commands: Command,
  manual: BookOpen,
};

const btnCls =
  'pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest backdrop-blur transition';

function ToolButton({ tool }: { tool: Tool }) {
  const open = useTools((s) => s.open);
  const toggleTool = useTools((s) => s.toggleTool);
  const Icon = ICONS[tool.id];
  const isOpen = open === tool.id;

  const content = (
    <>
      {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
      <span>{tool.label}</span>
      {tool.hotkey && (
        <kbd className="ml-0.5 rounded bg-white/10 px-1 py-px font-mono text-[9px] tracking-normal text-white/50">
          {tool.hotkey}
        </kbd>
      )}
    </>
  );

  // A link tool leaves the app; it has no open state.
  if (tool.kind === 'link') {
    return (
      <a
        href={tool.href}
        title={tool.description}
        data-tool={tool.id}
        className={`${btnCls} border-white/10 bg-black/40 text-white/60 hover:text-white`}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={() => toggleTool(tool.id)}
      title={tool.description}
      data-tool={tool.id}
      aria-pressed={isOpen}
      className={`${btnCls} ${
        isOpen
          ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
          : 'border-white/10 bg-black/40 text-white/60 hover:text-white'
      }`}
    >
      {content}
    </button>
  );
}

export default function ToolsBar() {
  return (
    <div className="absolute bottom-3 left-3 z-40 flex max-w-[min(28rem,calc(100vw-1.5rem))] flex-wrap items-center gap-1.5">
      {TOOLS.map((t) => (
        <ToolButton key={t.id} tool={t} />
      ))}
      {/* The deployed-commit badge rides the same meta strip (it used to be absolutely
          positioned into what is now the bar's space). */}
      <VersionBadge />
    </div>
  );
}
