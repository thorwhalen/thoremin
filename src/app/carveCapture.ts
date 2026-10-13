/**
 * The carve host's installation (#385 E2): bridges the SDK's capture seam (where a carve
 * tool's session provides its control while it is live, `@thoremin/sdk-ui/enroll/capture`) to
 * the command layer's carve host (`./commands/carveHost`), which a command may import. Imported
 * by the keyboard shortcuts, so the command and Space work from the moment the shell loads.
 */
import { carveCapture } from '@thoremin/sdk-ui/enroll/capture';
import { liveCarve, provideCarveHost } from './commands/carveHost';
import { registry } from './commands/registry';

provideCarveHost({ control: carveCapture });

/**
 * Space: toggle the live carve's capture through the command. Returns false when no carve is
 * live (or it is resting), so the key stays the browser's (a focused button, a scroll). A held
 * key's auto-repeat is swallowed, not dispatched: one press, one toggle.
 */
export function toggleCarveCapture(e?: Pick<KeyboardEvent, 'repeat'>): boolean {
  const control = liveCarve();
  if (!control || control.state() === 'rest') return false;
  if (!e?.repeat) void registry.dispatch('carve.capture.toggle', {});
  return true;
}
