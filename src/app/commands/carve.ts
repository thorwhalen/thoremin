/**
 * Carve commands (#385 E2) — the live carve's capture as an `acture` command, so Space, the
 * palette, a bound gesture or category, and the AI assistant all start, pause and resume a
 * carve tool's capture through the one dispatch surface (#87).
 *
 * Capturing is session state of the carve tool, never a dial (an instrument does not record
 * faces), which is why the command reaches it through the carve host seam (`./carveHost`).
 */
import { z } from 'zod';
import { defineCommand, ok, err } from 'acture';
import { liveCarve } from './carveHost';

const CATEGORY = 'Carve';

/** Explore: start capturing. Capturing: pause. Paused: resume. */
export const toggleCarveCaptureCmd = defineCommand({
  id: 'carve.capture.toggle',
  title: 'Start, pause or resume capturing',
  description:
    'In a carve tool (Your faces): while exploring, start capturing; while capturing, pause (nothing is collected); while paused, resume. Bound to Space.',
  category: CATEGORY,
  params: z.object({}),
  execute: async () => {
    const control = liveCarve();
    if (!control) return err('no_carve', 'No carve tool is reading the camera (in Your faces: Record my faces).');
    const before = control.state();
    if (before === 'rest') return err('resting', 'The rest is being recorded; capturing starts by itself when it ends.');
    control.toggle();
    return ok({ what: control.what, from: before, to: control.state() });
  },
});

export const CARVE_COMMANDS = [toggleCarveCaptureCmd] as const;
