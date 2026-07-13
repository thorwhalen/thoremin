/**
 * Command palette (#87 Phase 2) — a Cmd/Ctrl-K overlay over the thoremin command
 * registry. Every dial is a searchable, typed command: an enum renders an inline
 * dropdown picker, a bounded number a small form (via acture's AutoForm). Selecting
 * a command dispatches it into the dials store, which syncs to the audio in real
 * time — so the palette parametrizes the instrument live OR while stopped, no
 * special-casing. This is a UI *consumer* of the registry (it imports the palette /
 * cmdk / React), so it lives here in the app layer, not under `commands/` (which the
 * import firewall keeps to pure command handlers).
 *
 * The palette itself is headless cmdk; the dark-HUD theme is in `index.css` under
 * `.thoremin-palette`.
 *
 * Its open state lives in the shared {@link useTools} store rather than in local state,
 * so the ⌘K hotkey and the tools-bar button are the SAME switch. Before #136 the hotkey
 * was the only way in and nothing in the app — not even the app's own keyboard
 * cheat-sheet — mentioned it existed.
 */
import { useEffect } from 'react';
import { CommandPalette } from 'acture-palette-react';
import { AutoForm } from 'acture-forms-autoform';
import { registry } from './commands';
import { useToasts } from './toasts';
import { useTools } from './toolsStore';

const TOOL_ID = 'commands';

export default function CommandPaletteOverlay() {
  const open = useTools((s) => s.open) === TOOL_ID;
  const setOpen = (v: boolean) =>
    v ? useTools.getState().openTool(TOOL_ID) : useTools.getState().close();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); // toggle; beat the browser's own Cmd-K
        useTools.getState().toggleTool(TOOL_ID);
      } else if (e.key === 'Escape' && !e.defaultPrevented) {
        // A parameter sub-view (enum picker / AutoForm) handles Escape itself to
        // step BACK — it calls preventDefault, so we only close from the top-level
        // list (where Escape isn't prevented). Otherwise the whole palette would
        // tear down instead of returning to the command list.
        //
        // Only the palette's own Escape closes it: `close()` here would also dismiss a
        // different open tool, so we guard on being the open one.
        if (useTools.getState().open === TOOL_ID) useTools.getState().close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/70 pt-[14vh] backdrop-blur-sm"
      onMouseDown={() => setOpen(false)}
    >
      {/* stopPropagation so a click inside the panel doesn't close it */}
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-white/10 bg-neutral-900/95 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <CommandPalette
          registry={registry}
          formAdapter={AutoForm}
          placeholder="Set a dial — type a parameter…"
          onDispatched={(_cmd, result) => {
            // Close only when the write actually succeeded. A refused value
            // (errors-as-data) keeps the palette open and surfaces the reason,
            // rather than silently vanishing with the dial unchanged.
            if (result.ok) setOpen(false);
            else useToasts.getState().push(result.error.message, 5000, 'error');
          }}
          className="thoremin-palette"
        />
      </div>
    </div>
  );
}
