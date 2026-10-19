/**
 * The faces extension's shell tools, as data (#330, #385 E8, E9): a module with no runtime imports,
 * so the browser smoke's reachability sweep can import it beside core's `src/app/tools.ts` (#600
 * S16b). Plain data (no SDK import: this is the extension's pure side); the stub (`./ui.tsx`), which
 * type-checks them as `ExtensionToolDecl`s, lists them; the deferred half adds their panels.
 */

/** The face session's shell tool, as data (the deferred half `./lazy_ui.tsx` adds its panel). */
export const FACES_TOOL = {
  id: 'faces',
  label: 'Your faces',
  description: 'Record your own faces and carve them into categories you name and keep: the face categorizer.',
  group: 'mode',
  defaultPinned: false,
} as const;

/** The hand-shape session's shell tool (#385 E8): the same carve over one hand's shape. */
export const HANDS_TOOL = {
  id: 'hand-shapes',
  label: 'Your hand shapes',
  description: 'Record your own hand shapes and carve them into categories you name and keep; each one can fire a command.',
  group: 'mode',
  defaultPinned: false,
} as const;

/** The pose session's shell tool (#382 = #385 E9): the same carve over held body poses. */
export const POSES_TOOL = {
  id: 'poses',
  label: 'Your poses',
  description: 'Record your own body poses and carve them into categories you name and keep; each one can fire a command.',
  group: 'mode',
  defaultPinned: false,
} as const;
