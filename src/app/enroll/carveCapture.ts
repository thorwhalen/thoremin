/**
 * Space on a live carve (#385 E2): toggles the carve tool's capture through its command
 * (`carve.capture.toggle`, the faces extension's since #600 S11, registered by the shell's
 * contribution registry). The carve is the SDK's capture seam (`@thoremin/sdk-ui/enroll/capture`),
 * not an extension's internals, so the shell's keymap may bind it.
 */
import { carveCapture } from '@thoremin/sdk-ui/enroll/capture';
import './promptSpeech';
import { registry } from '../commands/registry';
// The extension commands (the carve's among them) are registered when the fold point loads.
import '../host/contributions';

/**
 * Space: toggle the live carve's capture through the command. Returns false when no carve is
 * live (the key is the browser's then); a held key's repeats and a press during the rest are the
 * carve's even during the rest (where it does nothing: a stray press must not press a
 * button the page has focused).
 */
export function toggleCarveCapture(e?: Pick<KeyboardEvent, 'repeat'>): boolean {
  const control = carveCapture();
  if (!control) return false;
  if (!e?.repeat && control.state() !== 'rest') void registry.dispatch('carve.capture.toggle', {});
  return true;
}
