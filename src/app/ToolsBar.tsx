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
 * It reads {@link useTools} for which tool is open and toggles it. Each tool's actual
 * surface mounts itself in App and renders when it is the open one.
 *
 * It also owns the way OUT of a tool that {@link Tool.runsDetached}. A panel being shut
 * is not the same as its tool being off: the Feature Lab's meters keep drawing over the
 * video after you close the panel, and the checkbox that stops them lives *inside* the
 * panel you just closed. So the bar shows a live dot while such a tool is running and
 * puts a stop button next to it — the state and its undo in the one place a player
 * already looks for "what else is here".
 */
import { FlaskConical, Command, BookOpen, Hand, X, type LucideIcon } from 'lucide-react';
import { TOOLS, type Tool } from './tools';
import { useTools } from './toolsStore';
import { useControls } from './store';
import VersionBadge from './VersionBadge';

/** The icon per tool id. Kept here (not in `tools.ts`) so the registry stays React-free
 *  and importable from plain Node tests. A tool with no icon still renders — label-only
 *  is fine, an icon-only button is not. */
const ICONS: Record<string, LucideIcon> = {
  lab: FlaskConical,
  commands: Command,
  gestures: Hand,
  manual: BookOpen,
};

const btnCls =
  'pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest backdrop-blur transition';

function ToolButton({
  tool,
  running = false,
  onStop,
}: {
  tool: Tool;
  /** The tool is DOING something right now, whether or not its panel is open. */
  running?: boolean;
  /** Stop it. Required (by {@link ToolsBar}) whenever `running` can be true. */
  onStop?: () => void;
}) {
  const open = useTools((s) => s.open);
  const toggleTool = useTools((s) => s.toggleTool);
  const Icon = ICONS[tool.id];
  const isOpen = open === tool.id;

  const content = (
    <>
      {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
      <span>{tool.label}</span>
      {/* A running tool reads as running even with its panel shut — otherwise the
          meters over the video have no visible source. */}
      {running && (
        <span
          data-running={tool.id}
          title={`${tool.label} is running`}
          className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]"
        />
      )}
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

  const toggle = (
    <button
      type="button"
      onClick={() => toggleTool(tool.id)}
      title={tool.description}
      data-tool={tool.id}
      aria-pressed={isOpen}
      className={`${btnCls} ${
        isOpen || running
          ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
          : 'border-white/10 bg-black/40 text-white/60 hover:text-white'
      }`}
    >
      {content}
    </button>
  );

  if (!running || !onStop) return toggle;

  // A sibling rather than a nested button (nesting is invalid HTML), grouped tight so
  // the two read as one control: the tool, and the way to stop it.
  return (
    <span className="flex items-center gap-px">
      {toggle}
      <button
        type="button"
        onClick={onStop}
        data-stop-tool={tool.id}
        title={`Stop ${tool.label} — turn the meters off`}
        aria-label={`Stop ${tool.label}`}
        className={`${btnCls} border-emerald-400/40 bg-emerald-500/20 px-2 text-emerald-200 hover:bg-emerald-500/30 hover:text-white`}
      >
        <X className="h-3 w-3 shrink-0" aria-hidden />
      </button>
    </span>
  );
}

export default function ToolsBar() {
  // The one detached-running signal there is today. Read here rather than inside
  // ToolButton so the button stays presentational and `tools.ts` stays React-free:
  // the registry declares THAT a tool can run detached, the shell knows what that
  // means for each one.
  const metersOn = useControls((s) => s.featureLab.show);
  const setFeatureLab = useControls((s) => s.setFeatureLab);
  const isRunning = (t: Tool) => t.runsDetached === true && t.id === 'lab' && metersOn;

  return (
    <div className="absolute bottom-3 left-3 z-40 flex max-w-[min(28rem,calc(100vw-1.5rem))] flex-wrap items-center gap-1.5">
      {TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          tool={t}
          running={isRunning(t)}
          onStop={t.id === 'lab' ? () => setFeatureLab({ show: false }) : undefined}
        />
      ))}
      {/* The deployed-commit badge rides the same meta strip (it used to be absolutely
          positioned into what is now the bar's space). */}
      <VersionBadge />
    </div>
  );
}
