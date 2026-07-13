/**
 * Which shell tool is open — a one-field zustand store shared by the tools bar (which
 * opens them) and each tool's surface (which renders when open).
 *
 * At most one tool is open at a time: they are full panels over a live instrument, and
 * the video is the primary cue. Opening a tool closes the previous one.
 *
 * The command palette's ⌘K hotkey writes here too, so the hotkey and the bar button are
 * the same open state rather than two independent flags that can disagree.
 */
import { create } from 'zustand';

interface ToolsState {
  /** The open tool's id (see {@link TOOLS}), or null when none is open. */
  open: string | null;
  /** Open a tool (closing any other). */
  openTool(id: string): void;
  /** Close whatever is open. */
  close(): void;
  /** Open `id` if closed, close it if it is the one already open. */
  toggleTool(id: string): void;
}

export const useTools = create<ToolsState>()((set) => ({
  open: null,
  openTool: (id) => set({ open: id }),
  close: () => set({ open: null }),
  toggleTool: (id) => set((s) => ({ open: s.open === id ? null : id })),
}));
