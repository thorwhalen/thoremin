/**
 * The patcher's shell tool, as data (#14): a module with no runtime imports, so the browser smoke's
 * reachability sweep can import it beside core's tools. The eager stub (`./ui.ts`) lists it; the
 * deferred half (`./lazy_ui.tsx`) adds its panel.
 */
export const PATCHER_TOOL = {
  id: 'patcher',
  label: 'Patcher',
  description: 'See how the instrument is wired right now, part by part, and tune any part from the settings that feed it.',
  group: 'tool',
  defaultPinned: false,
} as const;
