/**
 * The migration step of a dial whose overlay element moved out of core's overlay into its extension
 * (#600 S10, S18c): the element's options, stored until then at `overlay.<element>` in the same blob
 * (or saved instrument), move to `<dial>.<field>`. Shared, because each extension that takes an
 * element over from core writes the same step.
 */
import type { z } from 'zod';

/**
 * A step from the dial's version before the move: idempotent (a value already there is kept), and
 * nothing to move leaves the field for the schema's default. Returns a new value.
 */
export const movedFromOverlay =
  (element: string, field: string, schema: z.ZodTypeAny) =>
  (old: unknown, stored: Readonly<Record<string, unknown>>): unknown => {
    if (!old || typeof old !== 'object' || field in old) return old;
    // Only a valid value moves: a corrupt one (`{ show: null }`) would fail the whole dial's heal
    // and reset everything else in it; it is left behind, and the field takes its default.
    const from = (stored.overlay as Record<string, unknown> | undefined)?.[element];
    const legacy = schema.safeParse(from);
    return legacy.success && from !== undefined ? { ...(old as object), [field]: legacy.data } : old;
  };
