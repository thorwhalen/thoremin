/**
 * The harmony slice's view of the controls (`@thoremin/sdk-ui/host`'s seam), typed by its own
 * manifest: its three dials and two transient fields. A type-only import of the manifest, so no
 * runtime cycle.
 */
import { controlsFor } from '@thoremin/sdk-ui/host';
import type { HARMONY_EXTENSION } from '..';

export const harmonyControls = controlsFor<typeof HARMONY_EXTENSION>();
