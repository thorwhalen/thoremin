/**
 * Toaster — renders the transient notifications from the toast store as a
 * bottom-center stack. Click a toast to dismiss it early. Pointer-events are off
 * on the container so toasts never block the instrument underneath.
 */
import { useToasts } from './toasts';

export default function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className="pointer-events-auto rounded-full bg-emerald-600/90 px-4 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur transition hover:bg-emerald-600"
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
