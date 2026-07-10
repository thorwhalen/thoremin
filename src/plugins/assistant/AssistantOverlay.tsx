/**
 * The assistant's app-layer mount (#87 Phase 3) — the LIGHT half. Like the command
 * palette, this is a consumer of the acture command registry that lives in the DAG app
 * (the default experience, where the registry and instrument live) rather than in the
 * legacy-only PluginProvider. It renders a floating launcher and, on open, lazily loads
 * the actual chat ({@link ./AssistantChat}) so the heavy AI SDK never enters the initial
 * bundle — the same lazy-import discipline the ai-dj plugin uses for its overlay. Drop
 * `<AssistantOverlay/>` beside `<CommandPaletteOverlay/>` in the app shell.
 */
import { lazy, Suspense, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';

const AssistantChat = lazy(() => import('./AssistantChat'));

export default function AssistantOverlay() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
        className="absolute bottom-16 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-black shadow-2xl transition hover:bg-emerald-400"
      >
        <Bot className="h-5 w-5" />
      </button>
    );
  }
  return (
    <Suspense
      fallback={
        <div className="absolute bottom-16 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/80 text-black shadow-2xl">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      }
    >
      <AssistantChat onClose={() => setOpen(false)} />
    </Suspense>
  );
}
