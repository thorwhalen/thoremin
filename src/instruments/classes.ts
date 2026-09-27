/**
 * The instrument classes: the grouping, tint and glyph the Instruments view shows, and the
 * `class` an instrument spec declares (`docs/design/instruments-as-graphs-and-extensions.md`
 * §3.7; seam 5 of its table). Pure, so the spec schema in this package can validate a class
 * without importing the app; `src/app/library/category.ts` re-exports it for the view.
 */
/** One class of instrument: the grouping, tint and glyph the Instruments view shows. */
export interface InstrumentClass {
  id: string;
  label: string;
  emoji: string;
  /** A CSS colour the view may tint a class's cards with (the UX stream owns the palette). */
  colour: string;
}

/**
 * The classes of instrument, in display order. The SSOT for grouping in the Instruments
 * view and, once the instrument spec is persisted, for the `class` an instrument declares.
 *
 * `field` is shown as **Field instruments** (the maintainer's pick, 2026-09-27): the hand
 * plays a note field laid across the screen (x is the scale-snapped pitch, y the volume,
 * `voice_mapping.ts`), where an air instrument mimes a real instrument's action. The class
 * was first called `theremin`; {@link normaliseClassId} maps that id forward so anything
 * that wrote the old id (an exported spec, a hand-edited URL) still resolves.
 */
export const INSTRUMENT_CLASSES = [
  { id: 'field', label: 'Field instruments', emoji: '🖐️', colour: 'hsl(205 55% 48%)' },
  { id: 'air', label: 'Air instruments', emoji: '🌬️', colour: 'hsl(32 75% 50%)' },
] as const satisfies readonly InstrumentClass[];

export type InstrumentClassId = (typeof INSTRUMENT_CLASSES)[number]['id'];

/** The class an instrument falls into when nothing says otherwise. */
export const DEFAULT_CLASS: InstrumentClassId = 'field';

/** Former class ids and what they became. Read-boundary only: nothing writes these. */
export const LEGACY_CLASS_IDS: Readonly<Record<string, InstrumentClassId>> = { theremin: 'field' };

/** A current class id for `id`, following {@link LEGACY_CLASS_IDS}; `undefined` when unknown. */
export function normaliseClassId(id: string): InstrumentClassId | undefined {
  const current = LEGACY_CLASS_IDS[id] ?? id;
  return INSTRUMENT_CLASSES.some((c) => c.id === current) ? (current as InstrumentClassId) : undefined;
}

