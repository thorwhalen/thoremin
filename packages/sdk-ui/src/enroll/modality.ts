/**
 * The app half of the carve-out's modality seam (#385 E1): what a modality needs of the DOM
 * and the host, beside the pure {@link CarveModality} (`@thoremin/sdk/enroll/modality`).
 *
 * - {@link CarveModalityUi}: the crop region and the preview a still is drawn with, and where a
 *   saved categorizer of the modality can be played.
 * - {@link carveOwners} and {@link claimCarve}: the claim a carve tool holds while it reads the
 *   camera (the modality's feature groups, through feature demand) and the hush it holds so
 *   making faces at the camera does not play the instrument. Each owner releases only its own.
 */
import type { CarveModality } from '@thoremin/sdk/enroll/modality';
import { appFeatureDemand } from '../featureDemand';
import { controls } from '../host';

/** A box in video pixels. */
export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a saved categorizer of a modality can be played. */
export interface CarveTarget {
  /** `dial`: an instrument dial chooses it (the face's `faceCategorizer`); `command`: a
   *  category binding dispatches a command; `renderer`: a node turns categories into notes. */
  kind: 'dial' | 'command' | 'renderer';
  /** The dial key, the binding kind or the node type. */
  id: string;
  /** How the player reads it ("the instrument's Face categorizer"). */
  label: string;
}

export interface CarveModalityUi {
  readonly modality: CarveModality;
  /** The crop box for a still at the current frame, or null for the whole frame. */
  region(): PixelBox | null;
  /** An overlay drawn on a still, or as the picture when there is none (a hand skeleton, a
   *  stick figure), from the sidecar kept with the still. */
  drawPreview?(ctx: CanvasRenderingContext2D, sidecar: unknown, box: { w: number; h: number }): void;
  /** What to keep beside a still for {@link drawPreview} (normalised landmarks); never in the file. */
  sidecar?(): unknown;
  /** Where a saved categorizer of this modality can be played. */
  readonly targets: readonly CarveTarget[];
  /** The status while the modality's source loads, when it has one to report. */
  sourceStatus?(): { ready: boolean; text: string };
}

/** The claim owners of a modality's tool: the take's, and the live test's (its own, so ending a
 *  test never releases a recording's). */
export function carveOwners(modality: Pick<CarveModality, 'words'>): { carve: string; test: string } {
  const slug = modality.words.slug;
  return { carve: slug, test: `${slug}-test` };
}

/** Claim (or release) the modality's feature groups and the instrument's quiet, as `owner`. */
export function claimCarve(owner: string, modality: Pick<CarveModality, 'groups'>, on: boolean): void {
  if (on) appFeatureDemand.claim(owner, modality.groups);
  else appFeatureDemand.release(owner);
  try {
    controls().setHush(owner, on);
  } catch {
    // No hot store in this host (a test): nothing to hush.
  }
}
