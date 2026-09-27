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
 * Adding an air instrument is one entry in {@link AIR_INSTRUMENTS}: an id, its label and
 * emoji (they become the system tag), and the predicate that reads its dial. The list
 * grouping, the tag, the tooltip line and the reachability test all follow from it.
 */
import type { Settings } from '@/settings/schema';

/** One air instrument: a thing you play by miming it, detected from its dial. */
export interface AirInstrument {
  id: string;
  /** Shown as the system tag's tooltip and in the parametrization tooltip. */
  label: string;
  emoji: string;
  /** Whether it plays the instrument's scale (the Sound section's scale, root and range),
   *  so the list keeps describing the scale even with the theremin voices silent. */
  usesScale: boolean;
  /** True when these settings play this air instrument. */
  on: (s: Settings) => boolean;
}

/** The air instruments, in display order. SSOT for everything air-specific in the library. */
export const AIR_INSTRUMENTS = [
  { id: 'drum', label: 'Air drum', emoji: '🥁', usesScale: false, on: (s: Settings) => s.airDrum.enabled },
  // 🎸 for the bass; 🤘 for the air guitar (the air guitarist's own sign).
  { id: 'bass', label: 'Air bass', emoji: '🎸', usesScale: true, on: (s: Settings) => s.airBass.enabled },
  // The guitar plays the chords the player enrolled, not the scale.
  { id: 'guitar', label: 'Air guitar', emoji: '🤘', usesScale: false, on: (s: Settings) => s.airGuitar.enabled },
  // The flute plays the notes the player named when enrolling fingerings, not the scale.
  { id: 'flute', label: 'Air flute', emoji: '🪈', usesScale: false, on: (s: Settings) => s.airFlute.enabled },
] as const satisfies readonly AirInstrument[];

export type AirInstrumentId = (typeof AIR_INSTRUMENTS)[number]['id'];

/** The air instruments these settings play, in {@link AIR_INSTRUMENTS} order. */
export function airInstrumentsOf(s: Settings): AirInstrumentId[] {
  return AIR_INSTRUMENTS.filter((a) => a.on(s)).map((a) => a.id);
}

/**
 * The groups of the Instruments view, in display order.
 *
 * The non-air group is shown as **Field instruments** (the maintainer's pick, 2026-09-27):
 * the hand plays a note field laid across the screen (x is the scale-snapped pitch, y the
 * volume, `voice_mapping.ts`), where an air instrument mimes a real instrument's action.
 * The id stays `theremin`: ids belong to the instrument spec, and only the label is shown.
 */
export const INSTRUMENT_CATEGORIES = [
  { id: 'theremin', label: 'Field instruments' },
  { id: 'air', label: 'Air instruments' },
] as const;

export type InstrumentCategory = (typeof INSTRUMENT_CATEGORIES)[number]['id'];

/** The category an instrument that plays these air instruments belongs to. An air
 *  instrument wins: a theremin with a drum added is found where the drums are. */
export function categoryOfAir(air: readonly AirInstrumentId[]): InstrumentCategory {
  return air.length > 0 ? 'air' : 'theremin';
}

/** The category of an instrument's settings. */
export function categoryOf(s: Settings): InstrumentCategory {
  return categoryOfAir(airInstrumentsOf(s));
}

/**
 * Group names by category, preserving each group's incoming order (so the list's sort and
 * filter still apply inside a group). Every category appears, possibly empty; the view
 * decides what to show for an empty one. A name whose category is not known yet (its
 * derivation is still in flight) is listed with the field instruments, the default.
 */
export function groupByCategory<T>(
  items: readonly T[],
  categoryOfItem: (item: T) => InstrumentCategory | undefined,
): { id: InstrumentCategory; label: string; items: T[] }[] {
  return INSTRUMENT_CATEGORIES.map(({ id, label }) => ({
    id,
    label,
    items: items.filter((it) => (categoryOfItem(it) ?? 'theremin') === id),
  }));
}
