/**
 * Saved drum-pad layouts (#245): named sets of the air drum's pads.
 *
 * One instance of the {@link createNamedCollectionStore} facade (the zodal rule: a Zod
 * schema, a `DataProvider` target defaulting to localStorage, the UI behind it). The
 * LIVE pads are the `airDrum.pads` dial leaves, read by the node every tick; this is
 * the persistence layer only: saving copies the dial's pads into a named record, loading
 * writes a record's pads back through the command path (`padLayoutWrites`). Its own
 * storage key, so a layout can be reused across instruments and stays out of the dials'
 * persist version.
 */
import { z } from 'zod';
import { createNamedCollectionStore, type NamedCollectionStore } from '@/settings/namedCollection';
import { PAD_IDS, PadsSchema, type Pads } from '@thoremin/sdk/nodes/music/drum_pads';

/** localStorage key holding the saved pad layouts (the browser default target). */
export const PAD_LAYOUTS_STORAGE_KEY = 'thoremin-pad-layouts';

export const PadLayoutSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  pads: PadsSchema,
});
export type PadLayout = z.infer<typeof PadLayoutSchema>;

export type PadLayoutStore = NamedCollectionStore<PadLayout, Pads>;

/** Build a {@link PadLayoutStore}; localStorage by default, any `DataProvider` injectable. */
export const createPadLayoutStore = createNamedCollectionStore<PadLayout, 'pads'>({
  schema: PadLayoutSchema,
  storageKey: PAD_LAYOUTS_STORAGE_KEY,
  payloadKey: 'pads',
  idFallback: 'layout',
});

/** The fields of a pad, in the order a layout is written back. */
const PAD_FIELDS = ['on', 'shape', 'x', 'y', 'w', 'h', 'color', 'sound'] as const;

/**
 * The dial-leaf writes that put a layout on the instrument: every field of every slot,
 * as `[path, value]` pairs for one atomic `dial.patch` (a slot a layout leaves off is
 * written off, so loading replaces the kit rather than merging into it).
 */
export function padLayoutWrites(pads: Pads): [string, string | number | boolean][] {
  const out: [string, string | number | boolean][] = [];
  for (const id of PAD_IDS) for (const f of PAD_FIELDS) out.push([`airDrum.pads.${id}.${f}`, pads[id][f]]);
  return out;
}
