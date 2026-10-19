/**
 * The carve commands as DATA (#600 S11), part of the faces extension's eager stub: the palette,
 * the assistant and a saved binding list them before the extension's code loads. Their
 * implementations (`./carveCommandsUi.tsx`) ride the React stub too, so running one never loads
 * the deferred half. Their ids are the ones ever shipped (#385 E2): a saved binding names them.
 */
import { z } from 'zod';
import type { CommandDecl } from '@thoremin/sdk/instruments/extension';

const CATEGORY = 'Carve';

export const CARVE_COMMAND_DECLS: readonly CommandDecl[] = [
  {
    id: 'carve.capture.toggle',
    title: 'Start, pause or resume capturing',
    description:
      'In a carve tool (Your faces): while exploring, start capturing; while capturing, pause (nothing is collected); while paused, resume. Bound to Space.',
    category: CATEGORY,
    params: z.object({}),
  },
  {
    id: 'carve.burst.begin',
    title: 'Begin a burst',
    description:
      'In a carve tool (Your faces): while capturing or paused, start a burst - every frame is collected until carve.burst.end, then kept as ONE held face (named by the name typed beforehand, if any). Bound to holding B.',
    category: CATEGORY,
    params: z.object({}),
  },
  {
    id: 'carve.burst.end',
    title: 'End the burst',
    description:
      'In a carve tool (Your faces): end the burst begun by carve.burst.begin; it becomes one held face. Does nothing when no burst is held.',
    category: CATEGORY,
    params: z.object({}),
  },
];
