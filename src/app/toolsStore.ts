/**
 * Which shell tool is open, and whether the Tools launcher is — a small zustand store
 * shared by the bar and the launcher (which open tools) and each tool's surface (which
 * renders when open).
 *
 * At most one tool is open at a time: they are full panels over a live instrument, and
 * the video is the primary cue. Opening a tool closes the previous one, and closes the
 * launcher it was picked from.
 *
 * The command palette's ⌘K hotkey writes here too, so the hotkey and the bar button are
 * the same open state rather than two independent flags that can disagree.
 */
import { create } from 'zustand';

interface ToolsState {
  /** The open tool's id (see {@link TOOLS}), or null when none is open. */
  open: string | null;
  /** Whether the Tools launcher (the list of every tool) is open. */
  launcherOpen: boolean;
  /** Open a tool (closing any other, and the launcher). */
  openTool(id: string): void;
  /** Close whatever tool is open. */
  close(): void;
  /** Open `id` if closed, close it if it is the one already open. */
  toggleTool(id: string): void;
  /** Open the launcher if closed, close it if open. */
  toggleLauncher(): void;
  /** Close the launcher. */
  closeLauncher(): void;
}

export const useTools = create<ToolsState>()((set) => ({
  open: null,
  launcherOpen: false,
  openTool: (id) => set({ open: id, launcherOpen: false }),
  close: () => set({ open: null }),
  toggleTool: (id) => set((s) => ({ open: s.open === id ? null : id, launcherOpen: false })),
  toggleLauncher: () => set((s) => ({ launcherOpen: !s.launcherOpen })),
  closeLauncher: () => set({ launcherOpen: false }),
}));
