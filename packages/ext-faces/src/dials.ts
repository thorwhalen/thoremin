/**
 * The faces extension's dial slice (#330 P4): `faceCategorizer`, the categorizer the face chords
 * read and each category's chord. Pure: Zod only (the schema is `./schema`).
 */
import { dialSlice } from '@thoremin/sdk/instruments/extension';
import { DEFAULT_FACE_CATEGORIZER, FaceCategorizerDialSchema } from './schema';

export const FACES_DIAL_SLICES = [
  dialSlice({
    key: 'faceCategorizer',
    schema: FaceCategorizerDialSchema.default(DEFAULT_FACE_CATEGORIZER),
    kind: 'face-categorizer-config',
    meta: {
      facets: ['Face'],
      title: 'Face categorizer',
      description: 'Which categorizer reads your face for the face chords (the general model, or one of yours from Your faces), and the chord each of its categories plays',
    },
  }),
] as const;
