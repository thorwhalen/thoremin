/**
 * Toasts — a tiny transient-notification store. Used to surface "saved as
 * <name>" feedback after a recording is written (the web APIs expose the
 * filename but no absolute path, so we report the name). Auto-dismisses; a click
 * dismisses early. Kept separate from the controls store since these aren't
 * persisted instrument state.
 */
import { create } from 'zustand';

/** Toast severity — drives the colour (success/info vs failure). */
export type ToastLevel = 'info' | 'error';

export interface Toast {
  id: number;
  message: string;
  level: ToastLevel;
}

interface ToastState {
  toasts: Toast[];
  /** Show a toast; auto-dismisses after `ttlMs`. `level` styles it (error = red). */
  push(message: string, ttlMs?: number, level?: ToastLevel): void;
  dismiss(id: number): void;
}

let seq = 0;
const DEFAULT_TTL_MS = 4000;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (message, ttlMs = DEFAULT_TTL_MS, level = 'info') => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, message, level }] }));
    if (typeof setTimeout !== 'undefined') {
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttlMs);
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
