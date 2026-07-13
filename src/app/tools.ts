/**
 * TOOLS — the registry of the app shell's non-instrument surfaces (#136).
 *
 * A *tool* is something you use ON the instrument rather than a part of it: the
 * Feature Lab (measure the raw feature vectors), the command palette (set any dial by
 * name), the capabilities manual. Each entry declares what it is, how it opens, and —
 * crucially — that it opens **from the shell at all**.
 *
 * This registry exists because thoremin has shipped subsystems to production that no
 * player could find. The Feature Lab (#119) was live in the bundle for weeks, three
 * clicks deep inside a per-instrument editor, defaulting to off; MIDI out (#120) has no
 * entry point at all (#137). Both passed every test. The rule this file encodes:
 *
 *   **A feature only findable by someone who read the PR is not shipped.**
 *
 * So: add a tool here, and `ToolsBar` grows a labelled button for it automatically. A test
 * asserts the shell mounts a surface for every entry — registering a tool without giving
 * it a home fails the build, and building a tool without registering it means no button,
 * which is the failure mode we are pricing in.
 *
 * Kept React-free (plain data, no icons) so it is importable in plain Node tests; the
 * icon for each id is chosen in {@link ToolsBar}.
 */

/** How a tool opens. */
export type ToolKind =
  /** A panel in the shell, toggled by the tools bar (and tracked in {@link useTools}). */
  | 'panel'
  /** An overlay with its own hotkey; the bar button opens it too. */
  | 'overlay'
  /** A plain link out of the app (the generated manual). */
  | 'link';

export interface Tool {
  /** Stable id — the key `useTools.open` holds, and the `data-tool` test hook. */
  id: string;
  /** The button label. Shown, not just an aria-label: an unlabelled icon is how the
   *  command palette stayed invisible for a whole release. */
  label: string;
  /** One line, shown as the button's tooltip and as the panel's intro strapline. */
  description: string;
  kind: ToolKind;
  /** Displayed on the button and in the keyboard cheat-sheet, e.g. `⌘K`. */
  hotkey?: string;
  /** For `kind: 'link'` — the href. */
  href?: string;
}

export const TOOLS: readonly Tool[] = [
  {
    id: 'lab',
    label: 'Feature Lab',
    description:
      'Measure the raw face and hand features the instrument plays from — live, normalized meters.',
    kind: 'panel',
  },
  {
    id: 'commands',
    label: 'Commands',
    description: 'Search every dial by name and set it — the same command path the AI assistant uses.',
    kind: 'overlay',
    hotkey: '⌘K',
  },
  {
    id: 'manual',
    label: 'Manual',
    description: 'The generated capabilities manual: every node, dial, sound and overlay element.',
    kind: 'link',
    href: 'manual.html',
  },
] as const;

export const TOOL_IDS: readonly string[] = TOOLS.map((t) => t.id);

export const toolById = (id: string): Tool | undefined => TOOLS.find((t) => t.id === id);
