/**
 * The Feature Lab tool, as data (#119, #136; the Lab slice's since #600 S16b): a module with no
 * runtime imports, so the browser smoke's reachability sweep can import it beside core's
 * `src/app/tools/tools.ts`. The slice's React half (`./ui.tsx`) adds its panel, icon and stop control.
 */
export const LAB_TOOL = {
  id: 'lab',
  label: 'Feature Lab',
  description: 'Measure the raw face and hand features the instrument plays from — live, normalized meters.',
  group: 'tool',
  defaultPinned: false,
} as const;
