/**
 * The Music tool, as data: a tool used on any instrument (what the player says about the music
 * playing is about the music, not the instrument).
 */
export const MUSIC_TOOL = {
  id: 'music',
  label: 'Music',
  description: "Say the key of the music playing, tap its tempo, write its chords: the instrument can follow them.",
  group: 'tool',
  defaultPinned: false,
} as const;
