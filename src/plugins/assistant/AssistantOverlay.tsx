/**
 * The assistant's app-layer mount (#87 Phase 3) — the LIGHT half. Like the command
 * palette, this is a consumer of the acture command registry that lives in the DAG app
 * (the default experience, where the registry and instrument live) rather than in the
 * legacy-only PluginProvider. On open it lazily loads the actual chat
 * ({@link ./AssistantChat}) so the heavy AI SDK never enters the initial bundle — the
 * same lazy-import discipline the ai-dj plugin uses for its overlay.
 *
 * It is a registered shell TOOL (`assistant` in `src/app/tools.ts`), opened from the Tools
 * launcher or its pinned button like any other, and its open state is the shared
 * `useTools` one — as an INDEPENDENT tool (`Tool.independent`): opening a panel does not
 * close the chat (which would abort a reply in flight), and opening the chat does not
 * close the panel. It used to be a floating, unlabelled robot in the bottom-right corner:
 * the one control in the shell a first-time player could not name, and it sat on the
 * Instruments panel's last rows (Round 4, #266/#271).
 */
import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useTools } from '@/app/toolsStore';

const AssistantChat = lazy(() => import('./AssistantChat'));

/** The tool id in the shell registry. */
export const TOOL_ID = 'assistant';

export default function AssistantOverlay() {
  const open = useTools((s) => s.independentOpen[TOOL_ID] === true);
  if (!open) return null;
  const onClose = () => useTools.getState().closeIndependent(TOOL_ID);
  return (
    <Suspense
      fallback={
        <div
          aria-label="Loading the assistant"
          className="absolute bottom-16 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/80 text-black shadow-2xl"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      }
    >
      <AssistantChat onClose={onClose} />
    </Suspense>
  );
}
