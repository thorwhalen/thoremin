/**
 * The ASL extension's one dial: `asl`, the sign reader's node params lifted into the
 * settings (on/off, movement signs, confidence, smoothing, and the chord behaviour of the
 * ASL chords instrument). The chord key, sound and voicing are NOT here: they are the face
 * chords' (`faceChord.*`), so one chord section sets both.
 *
 * Pure: Zod and the node schema only.
 */
import { AslDialSchema, DEFAULT_ASL_DIAL } from './nodes/asl_signs';
import { dialSlice } from '@thoremin/sdk/instruments/extension';

export const AslSettingsSchema = AslDialSchema;
export const DEFAULT_ASL = DEFAULT_ASL_DIAL;

export const ASL_DIAL_SLICES = [
  dialSlice({
    key: 'asl',
    schema: AslSettingsSchema.default(DEFAULT_ASL),
    kind: 'asl-config',
    meta: {
      facets: ['Sign language'],
      title: 'Sign language (ASL)',
      description: 'Read ASL signs from the hand: on/off, the movement signs (J, Z, words), how confident a sign must be, smoothing, and whether A..G play chords of the key',
    },
  }),
] as const;
