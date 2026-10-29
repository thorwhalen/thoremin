/**
 * The Sound mapper tool, as data: a module with no runtime imports, so the smoke's reachability
 * sweep can import it beside core's tools. The React half (`./ui.tsx`) adds its panel and icon.
 */
/** A tool, not an instrument: the mapped sounds play under whatever instrument is loaded. */
export const SOUND_MAPPER_TOOL = {
  id: 'sound-mapper',
  label: 'Sound mapper',
  description: 'Teach it a few sounds (taps on a table, a pot) and give each a drum: then every tap plays its drum, in a few milliseconds.',
  group: 'tool',
  defaultPinned: false,
} as const;
