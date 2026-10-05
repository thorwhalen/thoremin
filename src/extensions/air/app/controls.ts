/**
 * The air extension's view of the controls (`@thoremin/sdk-ui/host`'s seam), typed by its own
 * manifest: its four dials and four transient fields, so a typo'd key or a wrong value is a
 * type error here as it was against the app's store. A type-only import of the manifest, so
 * no runtime cycle.
 */
import { controlsFor } from '@thoremin/sdk-ui/host';
import type { AIR_EXTENSION } from '../index';

export const airControls = controlsFor<typeof AIR_EXTENSION>();
