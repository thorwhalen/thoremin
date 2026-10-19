/**
 * Instrument categories (#249) — the one place that says which group of the Instruments
 * view an instrument belongs to. The maintainer's rule: *every instrument is chosen from
 * one place*. The air instruments (drum now; guitar, bass and flute next) are not tools
 * beside the instrument, they are instruments of a different category, listed in the same
 * view and chosen the same way — a click on the row loads its saved dials profile.
 *
 * A category is DERIVED, never stored, for the same reason system tags are (Decision 2 of
 * `docs/design/instrument-library.md`): it is a fact about the parametrization. An
 * instrument whose settings turn an air instrument on IS an air instrument, whether it
 * shipped that way or a player ticked "Drum in the air" on their own theremin and saved
 * it. A stale category is therefore impossible, and there is no field to migrate.
 *
 * Adding an instrument is one row of its extension's `catalog` (#600 S8): an id, its label and
 * emoji (they become the system tag), its class, and the predicate that reads its dial. The list
 * grouping, the tag, the tooltip line and the reachability test all follow from it; core names
 * no extension's instrument.
 */
import type { CatalogEntry } from '@thoremin/sdk/instruments/extension';
import type { Settings } from '@/settings/schema';
import { CONTRIBUTIONS } from '@/host/contributions';

/** One catalog row: an instrument an extension contributes, detected from its dial
 *  (`Extension.catalog`, #600 S8). */
export type AirInstrument = CatalogEntry;

/** The class an entry lists its instruments under. */
export const classOfEntry = (a: AirInstrument): InstrumentClassId => a.class;

/** The instrument catalog, in display order: every listed extension's rows (the air
 *  instruments', the sign reader's), folded by the contribution registry. A build without an
 *  extension has none of its rows. SSOT for everything instrument-specific in the library. */
export const INSTRUMENT_CATALOG: readonly AirInstrument[] = CONTRIBUTIONS.catalog;

/** A catalog row's id. */
export type AirInstrumentId = string;

/** The catalog rows these settings play, in {@link INSTRUMENT_CATALOG} order. */
export function airInstrumentsOf(s: Settings): AirInstrumentId[] {
  return INSTRUMENT_CATALOG.filter((a) => a.on(s as unknown as Readonly<Record<string, unknown>>)).map((a) => a.id);
}

export {
  INSTRUMENT_CLASSES,
  DEFAULT_CLASS,
  LEGACY_CLASS_IDS,
  normaliseClassId,
  type InstrumentClass,
  type InstrumentClassId,
} from '@/instruments/classes';
import { INSTRUMENT_CLASSES, DEFAULT_CLASS, type InstrumentClassId } from '@/instruments/classes';

/** @deprecated Use {@link INSTRUMENT_CLASSES}; kept so the view's imports keep working. */
export const INSTRUMENT_CATEGORIES = INSTRUMENT_CLASSES;
/** @deprecated Use {@link InstrumentClassId}. */
export type InstrumentCategory = InstrumentClassId;

/** The class an instrument that plays these air instruments belongs to. An air
 *  instrument wins: a field instrument with a drum added is found where the drums are.
 *  Among several, the first in {@link INSTRUMENT_CATALOG} order decides (the air ones lead). */
export function categoryOfAir(air: readonly AirInstrumentId[]): InstrumentClassId {
  const first = INSTRUMENT_CATALOG.find((a) => air.includes(a.id));
  return first ? first.class : DEFAULT_CLASS;
}

/** The class of an instrument's settings. */
export function categoryOf(s: Settings): InstrumentClassId {
  return categoryOfAir(airInstrumentsOf(s));
}

/**
 * Group names by class, preserving each group's incoming order (so the list's sort and
 * filter still apply inside a group). Every class appears, possibly empty; the view
 * decides what to show for an empty one. A name whose class is not known yet (its
 * derivation is still in flight) is listed with the field instruments, the default.
 */
export function groupByCategory<T>(
  items: readonly T[],
  categoryOfItem: (item: T) => InstrumentClassId | undefined,
): { id: InstrumentClassId; label: string; items: T[] }[] {
  return INSTRUMENT_CLASSES.map(({ id, label }) => ({
    id,
    label,
    items: items.filter((it) => (categoryOfItem(it) ?? DEFAULT_CLASS) === id),
  }));
}
