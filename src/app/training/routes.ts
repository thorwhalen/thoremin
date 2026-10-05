/**
 * Training routes (#263, #269): where "train this instrument" goes, resolved from the
 * instrument spec's `training` link (the instruments-as-graphs ADR, PR 4).
 *
 * A spec may declare `training: { route }`; when it does not, the route is derived from
 * what the instrument composes: an extension's instrument trains where its manifest's
 * `training` says (the air flute or guitar by a scripted sequence in its own settings
 * section, the air drum by a pattern take in its: `src/extensions/air/training.ts`), and
 * everything else
 * (the field instruments, whose control is a face or a hand the trainer carves
 * categories out of) by the Trainer tool (#163). The route is what the link in the
 * instrument's panel follows; the trainer stream owns this table, the spec only names
 * a route.
 *
 * Two kinds of destination: a **section** route scrolls to (and opens) the trainer that
 * lives inside one of the editor's settings sections, by the DOM id the trainer
 * renders; a **tool** route opens a shell tool. Pure but for `goToTraining`, which
 * touches the DOM and the tools store.
 */
import type { InstrumentSpec } from '@/instruments/spec';
import type { TrainingRoute } from '@thoremin/sdk/instruments/extension';
import { EXTENSION_TRAINING_BY_BRANCH, EXTENSION_TRAINING_ROUTES } from '@/extensions';

export type { TrainingRoute };

/** Every route: the extensions' own (their instruments train in their settings sections),
 *  then core's Trainer tool, the fallback. */
export const TRAINING_ROUTES: readonly TrainingRoute[] = [
  ...EXTENSION_TRAINING_ROUTES,
  {
    id: 'trainer',
    label: 'Open the Trainer',
    hint: 'A guided take of the faces or moves you can make; the instrument learns your own categories.',
    tool: 'trainer',
  },
];

export const routeById = (id: string): TrainingRoute | undefined => TRAINING_ROUTES.find((r) => r.id === id);

/** The branch each section route trains, in the order a lead instrument is looked for
 *  (each extension's table, in extension order). */
const BY_BRANCH = EXTENSION_TRAINING_BY_BRANCH;

/**
 * The route for a spec: its declared `training.route` when it names a known route, else
 * the first air branch it composes (explicit or derived features), else the Trainer.
 */
export function trainingRouteFor(spec: Pick<InstrumentSpec, 'training' | 'branches' | 'features'> | undefined): TrainingRoute {
  const declared = spec?.training?.route ? routeById(spec.training.route) : undefined;
  if (declared) return declared;
  const composed = new Set([...(spec?.branches ?? []), ...(spec?.features ?? [])]);
  for (const [branch, route] of BY_BRANCH) if (composed.has(branch)) return routeById(route)!;
  return routeById('trainer')!;
}

export interface GoToTrainingDeps {
  /** Open a shell tool by id. */
  openTool: (id: string) => void;
  /** The document to find a section route's anchor in. */
  doc?: Pick<Document, 'getElementById'>;
}

/**
 * Follow a route. A section route opens every collapsed `<details>` above the trainer
 * and scrolls it into view; it returns false when the trainer is not on the page (the
 * section is not rendered: the instrument's editor is closed). A tool route opens the
 * tool. Nothing here is awaited.
 */
export function goToTraining(route: TrainingRoute, deps: GoToTrainingDeps): boolean {
  if (route.tool) {
    deps.openTool(route.tool);
    return true;
  }
  if (!route.section) return false;
  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const el = doc?.getElementById(route.section.anchor);
  if (!el) return false;
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.tagName === 'DETAILS' && !(p as HTMLDetailsElement).open) (p as HTMLDetailsElement).open = true;
  }
  (el as HTMLElement).scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  return true;
}
