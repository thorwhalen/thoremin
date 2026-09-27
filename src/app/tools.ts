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
 * So: add a tool here, and the Tools launcher lists it, labelled and described, one click
 * from anywhere; pinned (by default or by the player), it also has its own button in the
 * bar (Round 4, Discussion #271: the bar stopped growing with every tool). A test asserts
 * the shell mounts a surface for every entry — registering a tool without giving it a home
 * fails the build.
 *
 * The tools are a COLLECTION: {@link ToolSchema} is the SSOT of what a tool is, and
 * `toolsCollection.ts` declares the collection's affordances (search, grouping) over it;
 * the launcher and the bar are renderings of that.
 *
 * Not every surface is a tool. An INSTRUMENT is chosen from the Instruments view, never
 * from here: the air drum was a tool panel for one release and moved out (#249) because
 * "one place to choose instruments from" is the maintainer's rule, not a preference.
 *
 * Kept React-free (data plus its schema, no icons) so it is importable in plain Node tests
 * and by the browser smoke; the icon for each id is chosen in {@link ToolsBar}.
 */
import { z } from 'zod';

/** How a tool opens. `panel`: a panel in the shell, tracked in `useTools`. `overlay`: an
 *  overlay (with its own hotkey when it has one); the launcher opens it too. `link`: a
 *  plain link out of the app (the generated manual). */
export const ToolKindSchema = z.enum(['panel', 'overlay', 'link']);
export type ToolKind = z.infer<typeof ToolKindSchema>;

/**
 * The launcher's sections, in display order. A *mode* takes the instrument over for a
 * session of its own (both hush it); a *tool* is used on the instrument between takes;
 * *help* is reference.
 */
export const TOOL_GROUPS = [
  { id: 'mode', label: 'Modes', hint: 'take over the instrument' },
  { id: 'tool', label: 'Tools', hint: 'use on the instrument' },
  { id: 'help', label: 'Help', hint: '' },
] as const;
export const ToolGroupSchema = z.enum(['mode', 'tool', 'help']);
export type ToolGroup = z.infer<typeof ToolGroupSchema>;

export const ToolSchema = z.object({
  /** Stable id — the key `useTools.open` holds, and the `data-tool` test hook. */
  id: z.string().min(1),
  /** The label. Always shown as text, never an icon alone: an unlabelled icon is how the
   *  command palette (and the assistant's robot) stayed invisible for a whole release. */
  label: z.string().min(1),
  /** One line: the launcher row's second line, the button's tooltip and the panel's
   *  intro strapline. */
  description: z.string().min(1),
  kind: ToolKindSchema,
  /** Which launcher section it is listed in. */
  group: ToolGroupSchema,
  /** Whether it has its own button in the bar until the player says otherwise. The
   *  player's choice (`toolPins.ts`) overrides it; this is only the out-of-the-box bar. */
  defaultPinned: z.boolean(),
  /** Displayed on the button and in the keyboard cheat-sheet, e.g. `⌘K`. */
  hotkey: z.string().optional(),
  /** For `kind: 'link'` — the href. */
  href: z.string().optional(),
  /**
   * True when the tool keeps **doing something visible after its panel is closed**.
   * The Feature Lab is the only one: its meters go on drawing over the video, which
   * is deliberate — you want to watch them while you play, with the panel out of the
   * way.
   *
   * It is also how the Lab became un-closable. `#136` asked "can a player FIND this?"
   * and answered it with this registry. Nobody asked the mirror question: once it is
   * running, can a player find the way back OUT? For the Lab the answer was no. The
   * off switch is a checkbox inside the panel, so closing the panel hid the only
   * control that could undo what the panel had started; the state is persisted, so a
   * reload brought the meters back; and the Lab is deliberately not a dial, so the
   * command palette could not reach it either. The video ended up covered in bars
   * with nothing on screen to explain them.
   *
   * So a tool that runs detached owes the bar a **stop** control, live whenever it is
   * running — pinned or not, reachable with its panel shut, and with no memory of how it
   * was started. `tools_shell.test.tsx` enforces that rather than trusting this comment.
   */
  runsDetached: z.boolean().optional(),
});
export type Tool = z.infer<typeof ToolSchema>;

/**
 * The shipped tools, in launcher order within each group. The default pins (Round 4,
 * #271) are the two modes and the command palette:
 *  - Conductor and Trainer each take over a whole session, and are what a player comes
 *    to the app to try, so they get a button;
 *  - Commands reaches every setting by name, and its pill teaches the ⌘K hotkey;
 *  - Feature Lab and Gestures are setup and diagnosis, used rarely (the Lab still shows
 *    itself in the bar whenever it is running); the Assistant needs a key before it can
 *    do anything, and a player who sets one up can pin it; the Manual is reference.
 */
export const TOOLS: readonly Tool[] = z.array(ToolSchema).parse([
  {
    id: 'conductor',
    label: 'Conductor',
    description:
      'Conduct a score with your hand: beat time in front of the camera and the piece follows your tempo and dynamics.',
    kind: 'panel',
    group: 'mode',
    defaultPinned: true,
  },
  {
    id: 'trainer',
    label: 'Trainer',
    description:
      'Teach the instrument the faces you can actually make — a one-minute guided take, then pick how many categories.',
    kind: 'panel',
    group: 'mode',
    defaultPinned: true,
  },
  {
    id: 'commands',
    label: 'Commands',
    description: 'Search every dial by name and set it — the same command path the AI assistant uses.',
    kind: 'overlay',
    group: 'tool',
    defaultPinned: true,
    hotkey: '⌘K',
  },
  {
    id: 'assistant',
    label: 'Assistant',
    description: 'Chat with an AI that operates the instrument for you (bring your own API key).',
    kind: 'overlay',
    group: 'tool',
    defaultPinned: false,
  },
  {
    id: 'lab',
    label: 'Feature Lab',
    description:
      'Measure the raw face and hand features the instrument plays from — live, normalized meters.',
    kind: 'panel',
    group: 'tool',
    defaultPinned: false,
    runsDetached: true,
  },
  {
    id: 'gestures',
    label: 'Gestures',
    description:
      'Bind hand poses (fist, open palm, pinch) to commands for hands-free control — hold a pose to fire it.',
    kind: 'panel',
    group: 'tool',
    defaultPinned: false,
  },
  {
    id: 'manual',
    label: 'Manual',
    description: 'The generated capabilities manual: every node, dial, sound and overlay element.',
    kind: 'link',
    group: 'help',
    defaultPinned: false,
    href: 'manual.html',
  },
]);

export const TOOL_IDS: readonly string[] = TOOLS.map((t) => t.id);

export const toolById = (id: string): Tool | undefined => TOOLS.find((t) => t.id === id);
