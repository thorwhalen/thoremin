/**
 * The standalone game pages: `play/<name>.html` (their code in `play/src/`), each a build entry of its own (`vite.config.ts`)
 * and each held by `scripts/check_play_bundle.ts` to the modules a game needs.
 */
export const PLAY_PAGES = ['match-the-note', 'pop-the-notes', 'pitch-maze', 'vowels'] as const;
