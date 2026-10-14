/**
 * The faces extension's dial slices: `faceCategorizer` (#330 P4), the categorizer the face chords
 * read and each category's chord; `poseCategorizer` (#384), the pose categorizer the instrument
 * reads, draws and may conduct with; `categorizerChords` (#450), the hand-shape or pose categorizer
 * whose categories play chords. Pure: Zod only (the schema is `./schema`).
 */
import { dialSlice } from '@thoremin/sdk/instruments/extension';
import { CategorizerChordsDialSchema, DEFAULT_CATEGORIZER_CHORDS, DEFAULT_FACE_CATEGORIZER, DEFAULT_POSE_CATEGORIZER, FaceCategorizerDialSchema, PoseCategorizerDialSchema } from './schema';

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
  dialSlice({
    key: 'poseCategorizer',
    schema: PoseCategorizerDialSchema.default(DEFAULT_POSE_CATEGORIZER),
    kind: 'pose-categorizer-config',
    meta: {
      facets: ['Body'],
      title: 'Pose categorizer',
      description: "Which of your saved poses (from Your poses) the instrument reads and draws, and whether your ready, fermata and cut-off poses start, hold and stop the body conductor in place of the rules",
    },
  }),
  dialSlice({
    key: 'categorizerChords',
    schema: CategorizerChordsDialSchema.default(DEFAULT_CATEGORIZER_CHORDS),
    kind: 'categorizer-chords-config',
    meta: {
      facets: ['Hands', 'Body'],
      title: 'Categorizer chords',
      description: 'Which of your saved hand shapes or poses (from Your hand shapes or Your poses) plays chords, and the chord each of its categories plays',
    },
  }),
] as const;
