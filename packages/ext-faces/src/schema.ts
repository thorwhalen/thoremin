/**
 * The faces extension's one dial, as Zod only (#330 P4): which categorizer the instrument's face
 * chords read, and the chord each of its categories plays. Eager (the stub imports it), so it
 * imports no node, no model and no React.
 *
 * - `id`: `general` (the shipped expression model, the default: nothing changes for an existing
 *   instrument) or the id of one of the player's saved categorizers. The instrument keeps the id,
 *   not the model: the model stays in the player's collection on this device, and an id this
 *   device does not have plays the general model (a reversible default, recorded on #330).
 * - `degrees`: the scale degree each category plays, by category id (`cat-1`..). A FIXED set of
 *   slots, like the air drum's pads, so every one is a command-path leaf (`dial.setIn`); the
 *   carving tool makes at most {@link MAX_CATEGORY_SLOTS} categories. {@link AUTO_DEGREE} (the
 *   default) plays the degree of the expression the category stands in for; -1 is silence.
 */
import { z } from 'zod';
import { GENERAL_CATEGORIZER_ID } from '@thoremin/sdk/music/expression';

/** The general (shipped) expression model: the categorizer id that changes nothing. Since
 *  #330 P6 the general model is a categorizer like the others, under this id (the SDK's). */
export const GENERAL_CATEGORIZER = GENERAL_CATEGORIZER_ID;

/** A category with no degree of its own: it plays the expression it stands in for. */
export const AUTO_DEGREE = -2;

/** The category slots the dial carries (the carving tool's largest k). */
export const MAX_CATEGORY_SLOTS = 12;

/** The slot id of the category at `index` (0-based): the ids `createCarver` gives. */
export const categorySlot = (index: number): string => `cat-${index + 1}`;

export const CATEGORY_SLOTS: readonly string[] = Array.from({ length: MAX_CATEGORY_SLOTS }, (_, i) => categorySlot(i));

const DegreeSchema = z.number().int().min(AUTO_DEGREE).max(6);

export const FaceCategorizerDialSchema = z.object({
  id: z.string().min(1).default(GENERAL_CATEGORIZER),
  // Defaulted as a whole too, so a partial value (`{ id }` alone: a hand-edited or older
  // instrument) parses rather than failing the settings schema.
  degrees: z.object(Object.fromEntries(CATEGORY_SLOTS.map((s) => [s, DegreeSchema.default(AUTO_DEGREE)])) as Record<string, z.ZodDefault<typeof DegreeSchema>>).prefault({}),
});
export type FaceCategorizerDial = z.infer<typeof FaceCategorizerDialSchema>;

export const DEFAULT_FACE_CATEGORIZER: FaceCategorizerDial = FaceCategorizerDialSchema.parse({ degrees: {} });

/** The dial's own degrees, AUTO dropped: what the renderer reads (`category-degrees`). */
export function ownDegrees(dial: Partial<FaceCategorizerDial> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, d] of Object.entries(dial?.degrees ?? {})) if (typeof d === 'number' && d > AUTO_DEGREE) out[id] = d;
  return out;
}

/** Whether the dial names a personal categorizer (anything but the general model). */
export const isPersonal = (dial: Partial<FaceCategorizerDial> | null | undefined): boolean =>
  typeof dial?.id === 'string' && dial.id !== '' && dial.id !== GENERAL_CATEGORIZER;

/**
 * The dial writes that point an instrument at categorizer `id`, as one `dial.patch`: the id,
 * every category slot back to Auto (the chords chosen for another categorizer mean nothing for
 * this one), and the face chords on when the face plays nothing yet (`faceMapping` is the
 * instrument's current face mapping). One patch, so the switch is one undoable step.
 */
export function chooseCategorizerWrites(id: string, faceMapping: string): [string, unknown][] {
  const writes: [string, unknown][] = [['faceCategorizer.id', id]];
  for (const slot of CATEGORY_SLOTS) writes.push([`faceCategorizer.degrees.${slot}`, AUTO_DEGREE]);
  if (id !== GENERAL_CATEGORIZER && faceMapping === 'none') writes.push(['face.mapping', 'chord']);
  return writes;
}

/**
 * The pose categorizer an instrument plays (#384, body-movement B4): the id of one of the player's
 * saved pose categorizers ('' = none, the default: nothing changes for an existing instrument),
 * and whether its `ready` / `fermata` / `cut-off` categories start, hold and cut off the body
 * conductor in place of the rules (#387 B5: rules by default, a pose category as the player's
 * override). The instrument keeps the id, not the model, as `faceCategorizer` does; an id this
 * device does not have plays nothing.
 */
export const PoseCategorizerDialSchema = z.object({
  id: z.string().default(''),
  transport: z.boolean().default(false),
});
export type PoseCategorizerDial = z.infer<typeof PoseCategorizerDialSchema>;
export const DEFAULT_POSE_CATEGORIZER: PoseCategorizerDial = PoseCategorizerDialSchema.parse({});

/** Whether the dial names a pose categorizer to play. */
export const playsPoses = (dial: Partial<PoseCategorizerDial> | null | undefined): boolean => typeof dial?.id === 'string' && dial.id !== '';
