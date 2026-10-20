/**
 * The Trainer tool's data (#160/#163; an extension tool since #600 S16d), import-free so a smoke
 * test can read it without loading the app: what the launcher and the bar show. Its panel and
 * behaviour are in `./ui.tsx`.
 */
export const TRAINER_TOOL = {
  id: 'trainer',
  label: 'Trainer',
  description: 'Teach the instrument the faces you can actually make — a one-minute guided take, then pick how many categories.',
  group: 'mode',
  defaultPinned: true,
  // Its open panel hushes the instrument, so the click and the spoken cues are audible.
  hushes: 'while the Trainer is open',
  // Where it was as a core tool: ahead of the command palette in the bar and the launcher.
  before: 'commands',
} as const;
