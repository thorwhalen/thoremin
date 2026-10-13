/**
 * The face's app half of the carve modality (#385 E1): the one place the tool says which
 * modality it carves. The crop region is the whole frame until stills are cropped at capture
 * (#385 E3); a face categorizer is played by the instrument's `faceCategorizer` dial.
 */
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import type { CarveModalityUi } from '@thoremin/sdk-ui/enroll/modality';

export const faceModalityUi: CarveModalityUi = {
  modality: faceModality,
  region: () => null,
  targets: [{ kind: 'dial', id: 'faceCategorizer', label: "the instrument's Face categorizer" }],
};
