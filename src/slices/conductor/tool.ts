/**
 * The Conductor tool's data (#187; an extension tool since #600 S18b), import-free so a smoke test can
 * read it without loading the app: what the launcher and the bar show. Its panel and behaviour are in
 * `./ui.tsx`.
 */
export const CONDUCTOR_TOOL = {
  id: 'conductor',
  label: 'Conductor',
  description: 'Conduct a score with your hand: beat time in front of the camera and the piece follows your tempo and dynamics.',
  group: 'mode',
  defaultPinned: true,
  // Where it was as core's first tool: ahead of the Trainer in the bar and the launcher.
  before: 'trainer',
} as const;
