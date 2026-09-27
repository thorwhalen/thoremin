/**
 * ToolsBar — the bottom-left strip of shell affordances (#136; Round 4, #271): the Tools
 * launcher button, then one button per PINNED tool, then any tool that is running.
 *
 * This is the answer to "how does a player find the Feature Lab / the command palette",
 * and the reason both were invisible: nothing in the shell ever mentioned them. Every
 * button carries a visible TEXT label, not just an icon — the AI assistant's unlabelled
 * robot icon and the palette's hotkey-only affordance are exactly the two things a first
 * time player never discovers. The launcher lists EVERY tool, labelled and described, so
 * a tool without a pin is still one click from anywhere; the pins (the player's choice,
 * `toolPins.ts`, over each tool's `defaultPinned`) decide which also get a button here,
 * so the bar no longer grows with every tool. On a phone-width screen only the launcher
 * (and a running tool) shows: the bottom strip is shared with the take cluster.
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
 *
 * And it owns its own height. The bar wraps to more rows as tools are added or the screen
 * narrows, and the tool panels open ABOVE it: anchored at a constant, they covered the
 * bar's first row as soon as it wrapped, so switching tool meant closing the open one
 * first. The bar writes its live height to the `--tools-bar-h` CSS variable, which the
 * `.shell-tool-panel` and `.shell-instruments-card` rules in `index.css` read.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { LayoutGrid, X } from 'lucide-react';
import { TOOLS, type Tool } from './tools';
import { TOOL_ICONS } from './toolIcons';
import { isPinned } from './toolsCollection';
import { useToolPins } from './toolPins';
import { searchTools } from './toolsCatalog';
import { useTools } from './toolsStore';
import { publishHeight, TOOLS_BAR_HEIGHT_VAR } from './shellLayout';
import { useControls } from './store';
import { useDialsSettings } from './dials/useDialsSettings';
import { dispatchDialSetIn } from './dispatchDial';
import type { ConductorSettings } from '@/settings/schema';
import VersionBadge from './VersionBadge';

/** The launcher's hotkey (bound in `keyboardShortcuts.ts`), shown on its button. */
export const LAUNCHER_HOTKEY = 'T';

const btnCls =
  'pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest backdrop-blur transition';

function ToolButton({
  tool,
  running = false,
  onStop,
  stopHint,
  className = '',
}: {
  tool: Tool;
  /** The stop button's tooltip: what stopping this tool does. */
  stopHint?: string;
  /** Extra classes on the outermost element (the bar hides pins on a narrow screen). */
  className?: string;
  /** The tool is DOING something right now, whether or not its panel is open. */
  running?: boolean;
  /** Stop it. Required (by {@link ToolsBar}) whenever `running` can be true. */
  onStop?: () => void;
}) {
  const isOpen = useTools((s) => s.open === tool.id || s.independentOpen[tool.id] === true);
  const toggleTool = useTools((s) => s.toggleTool);
  const Icon = TOOL_ICONS[tool.id];

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
        className={`${btnCls} border-white/10 bg-black/40 text-white/60 hover:text-white ${className}`}
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
      } ${running && onStop ? '' : className}`}
    >
      {content}
    </button>
  );

  if (!running || !onStop) return toggle;

  // A sibling rather than a nested button (nesting is invalid HTML), grouped tight so
  // the two read as one control: the tool, and the way to stop it.
  return (
    <span className={`flex items-center gap-px ${className}`}>
      {toggle}
      <button
        type="button"
        onClick={onStop}
        data-stop-tool={tool.id}
        title={`Stop ${tool.label}${stopHint ? ` — ${stopHint}` : ''}`}
        aria-label={`Stop ${tool.label}`}
        className={`${btnCls} border-emerald-400/40 bg-emerald-500/20 px-2 text-emerald-200 hover:bg-emerald-500/30 hover:text-white`}
      >
        <X className="h-3 w-3 shrink-0" aria-hidden />
      </button>
    </span>
  );
}

/** Per {@link Tool.runsDetached} tool: whether it is running now, and how to stop it.
 *  Read here rather than inside ToolButton so the button stays presentational and
 *  `tools.ts` stays React-free: the registry declares THAT a tool can run detached, the
 *  shell knows what that means for each one. A detached tool with no entry here gets no
 *  stop control, which `tools_shell.test.tsx` refuses. */
function useDetached(): Record<string, { running: boolean; stop: () => void; hint: string }> {
  const metersOn = useControls((s) => s.featureLab.show);
  const setFeatureLab = useControls((s) => s.setFeatureLab);
  const { state } = useDialsSettings();
  const conducting = ((state.effective.conductor ?? {}) as Partial<ConductorSettings>).enabled === true;
  return {
    lab: { running: metersOn, stop: () => setFeatureLab({ show: false }), hint: 'turn the meters off' },
    // Through the single write path: `conductor.enabled` is a dial.
    conductor: {
      running: conducting,
      stop: () => void dispatchDialSetIn('conductor.enabled', false),
      hint: 'stop conducting (the instrument sounds again)',
    },
  };
}

export default function ToolsBar() {
  const detached = useDetached();
  const isRunning = (t: Tool) => t.runsDetached === true && detached[t.id]?.running === true;
  const choices = useToolPins((s) => s.choices);
  const launcherOpen = useTools((s) => s.launcherOpen);
  const toggleLauncher = useTools((s) => s.toggleLauncher);
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => publishHeight(barRef.current, TOOLS_BAR_HEIGHT_VAR), []);
  useEffect(() => {
    void useToolPins.getState().hydrate();
    // Prime the launcher's list, so its first open shows every tool at once.
    void searchTools('');
  }, []);

  // Pinned tools, plus any tool that is running whether pinned or not: a running tool's
  // way out must never depend on a pin (see `Tool.runsDetached`).
  const shown = TOOLS.filter((t) => isPinned(t, choices) || isRunning(t));

  return (
    <div
      ref={barRef}
      data-tools-bar
      className="absolute bottom-3 left-3 z-40 flex max-w-[max(7rem,calc(100vw-20rem))] flex-wrap items-center gap-1.5"
    >
      <button
        type="button"
        onClick={toggleLauncher}
        data-tools-launcher
        aria-expanded={launcherOpen}
        aria-haspopup="dialog"
        title="Every tool, with what it does. Pin one to keep it in this bar."
        className={`${btnCls} ${
          launcherOpen
            ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
            : 'border-white/10 bg-black/40 text-white/70 hover:text-white'
        }`}
      >
        <LayoutGrid className="h-3 w-3 shrink-0" aria-hidden />
        <span>Tools</span>
        {/* No key hint where there is no keyboard to speak of. */}
        <kbd className="ml-0.5 rounded bg-white/10 px-1 py-px font-mono text-[9px] tracking-normal text-white/50 max-sm:hidden">
          {LAUNCHER_HOTKEY}
        </kbd>
      </button>
      {shown.map((t) => (
        <ToolButton
          key={t.id}
          tool={t}
          running={isRunning(t)}
          onStop={detached[t.id]?.stop}
          stopHint={detached[t.id]?.hint}
          // Narrow screens keep only the launcher and running tools in the strip.
          className={isRunning(t) ? '' : 'max-sm:hidden'}
        />
      ))}
      {/* The deployed-commit badge rides the same meta strip (it used to be absolutely
          positioned into what is now the bar's space). */}
      <VersionBadge />
    </div>
  );
}
