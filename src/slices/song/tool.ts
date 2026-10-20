/**
 * The Song tool, as data (#186 PR G; the song slice's since #600 S15): a module with no runtime
 * imports, so the browser smoke's reachability sweep can import it beside core's `src/app/tools/tools.ts`.
 * Plain data (no SDK import: this is the slice's pure side); the React half (`./ui.tsx`), which
 * type-checks it as an `ExtensionTool`, adds its panel, icon and stop control.
 */
/** A tool, not a mode: the song plays under whatever instrument is loaded. */
export const SONG_TOOL = {
  id: 'song',
  label: 'Song',
  description: 'Load a song to dance or play along to: its beat is tracked in the browser, and it plays at any tempo without changing pitch.',
  group: 'tool',
  defaultPinned: false,
} as const;
