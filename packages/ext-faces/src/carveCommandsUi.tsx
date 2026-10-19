/**
 * The carve commands (#385 E2), the faces extension's own since #600 S11 (they were core's): the
 * live carve's capture as `acture` commands, so Space, the palette, a bound gesture or category
 * and the AI assistant all start, pause and resume a carve tool's capture, and begin and end a
 * burst, through the one dispatch surface (#87). Capturing is session state of the carve tool,
 * never a dial, which is why the commands reach it through the SDK's capture seam.
 *
 * Declared as data in the extension's pure manifest (`./carveCommands.ts`, so they are listed
 * before the extension loads) and implemented here, for its React stub (`./ui.tsx`, which carries
 * them; at the root of `src/`, where a stub's imports must live, and `.tsx` because it is the app side): each is a thin call onto the
 * SDK's capture seam, which only the deferred half's session store provides, so running one never
 * needs that half loaded (with no carve live it answers so at once). Their ids are the ones
 * ever shipped: a saved binding names them.
 */
import { defineCommand, ok, err } from 'acture';
import { carveCapture } from '@thoremin/sdk-ui/enroll/capture';
import { CARVE_COMMAND_DECLS } from './carveCommands';

const decl = (id: string) => CARVE_COMMAND_DECLS.find((d) => d.id === id)!;

export const toggleCarveCaptureCmd = defineCommand({
  ...decl('carve.capture.toggle'),
  params: decl('carve.capture.toggle').params as never,
  execute: async () => {
    const control = carveCapture();
    if (!control) return err('no_carve', 'No carve tool is reading the camera (in Your faces: Record my faces).');
    const before = control.state();
    if (before === 'rest') return err('resting', 'The rest is being recorded; capturing starts by itself when it ends.');
    control.toggle();
    return ok({ what: control.what, from: before, to: control.state() });
  },
});

export const beginCarveBurstCmd = defineCommand({
  ...decl('carve.burst.begin'),
  params: decl('carve.burst.begin').params as never,
  execute: async () => {
    const control = carveCapture();
    if (!control) return err('no_carve', 'No carve tool is reading the camera (in Your faces: Record my faces).');
    const state = control.state();
    if (state !== 'capturing' && state !== 'paused') return err('not_capturing', 'A burst needs capturing started (Start capturing); it works while capturing or paused.');
    if (!control.beginBurst()) return err('burst_refused', 'The burst could not start (one may already be held).');
    return ok({ what: control.what, state });
  },
});

export const endCarveBurstCmd = defineCommand({
  ...decl('carve.burst.end'),
  params: decl('carve.burst.end').params as never,
  execute: async () => {
    const control = carveCapture();
    if (!control) return err('no_carve', 'No carve tool is reading the camera (in Your faces: Record my faces).');
    return ok({ what: control.what, ended: control.endBurst() });
  },
});

export const CARVE_COMMANDS = [toggleCarveCaptureCmd, beginCarveBurstCmd, endCarveBurstCmd] as const;
