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

/** A burst is held, so it is two commands: a pedal, a MIDI note or a gesture binds one to the
 *  press and one to the release (a category entry binds `begin`, another `end`). The panel's B key
 *  and button reach the same take through the store directly (the extension owns that surface). */
export const beginCarveBurstCmd = defineCommand({
  id: 'carve.burst.begin',
  title: 'Begin a burst',
  description:
    'In a carve tool (Your faces): while capturing or paused, start a burst - every frame is collected until carve.burst.end, then kept as ONE held face (named by the name typed beforehand, if any). Bound to holding B.',
  category: CATEGORY,
  params: z.object({}),
  execute: async () => {
    const control = liveCarve();
    if (!control) return err('no_carve', 'No carve tool is reading the camera (in Your faces: Record my faces).');
    const state = control.state();
    if (state !== 'capturing' && state !== 'paused') return err('not_capturing', 'A burst needs capturing started (Start capturing); it works while capturing or paused.');
    if (!control.beginBurst()) return err('burst_refused', 'The burst could not start (one may already be held).');
    return ok({ what: control.what, state });
  },
});

export const endCarveBurstCmd = defineCommand({
  id: 'carve.burst.end',
  title: 'End the burst',
  description: 'In a carve tool (Your faces): end the burst begun by carve.burst.begin; it becomes one held face. Does nothing when no burst is held.',
  category: CATEGORY,
  params: z.object({}),
  execute: async () => {
    const control = liveCarve();
    if (!control) return err('no_carve', 'No carve tool is reading the camera (in Your faces: Record my faces).');
    return ok({ what: control.what, ended: control.endBurst() });
  },
});

export const CARVE_COMMANDS = [toggleCarveCaptureCmd, beginCarveBurstCmd, endCarveBurstCmd] as const;
