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
 */
import { useEffect, useState } from 'react';
import { CommandPalette } from 'acture-palette-react';
import { AutoForm } from 'acture-forms-autoform';
import { registry } from './commands';
import { useToasts } from './toasts';

export default function CommandPaletteOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); // toggle; beat the browser's own Cmd-K
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && !e.defaultPrevented) {
        // A parameter sub-view (enum picker / AutoForm) handles Escape itself to
        // step BACK — it calls preventDefault, so we only close from the top-level
        // list (where Escape isn't prevented). Otherwise the whole palette would
        // tear down instead of returning to the command list.
        setOpen(false);
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
