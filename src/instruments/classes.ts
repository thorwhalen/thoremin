/**
 * The instrument classes: the grouping, tint and glyph the Instruments view shows, and the
 * `class` an instrument spec declares (`docs/design/instruments-as-graphs-and-extensions.md`
 * §3.7; seam 5 of its table). Pure, so the spec schema in this package can validate a class
 * without importing the app; `src/app/library/category.ts` re-exports it for the view.
 *
 * Core owns ONE class, `field`. Every other class is an extension's contribution
 * (`Extension.classes`, #600 S8): the air instruments contribute `air`, the ASL plugin `sign`.
 * The contribution registry (`src/host/contributions.ts`) registers them here once, when it folds
 * the build's extension list, so the list below grows before anything reads it (the registry is
 * imported by every module that lists or validates classes); this package never names an
 * extension.
 */
import type { InstrumentClass } from '@thoremin/sdk/instruments/extension';

export type { InstrumentClass };

/**
 * `field` is shown as **Field instruments** (the maintainer's pick, 2026-09-27): the hand
 * plays a note field laid across the screen (x is the scale-snapped pitch, y the volume,
 * `voice_mapping.ts`), where an air instrument mimes a real instrument's action. The class
 * was first called `theremin`; {@link normaliseClassId} maps that id forward so anything
 * that wrote the old id (an exported spec, a hand-edited URL) still resolves.
 */
export const CORE_CLASSES: readonly InstrumentClass[] = [{ id: 'field', label: 'Field instruments', emoji: '🖐️', colour: 'hsl(205 55% 48%)' }];

/** The classes of instrument, in display order: core's, then the extensions' as registered.
 *  The SSOT for grouping in the Instruments view and for the `class` an instrument declares. */
export const INSTRUMENT_CLASSES: InstrumentClass[] = [...CORE_CLASSES];

/** A class id: core's `field` or one an extension contributed. */
export type InstrumentClassId = string;

/** The class an instrument falls into when nothing says otherwise. */
export const DEFAULT_CLASS: InstrumentClassId = 'field';

/** Former class ids and what they became. Read-boundary only: nothing writes these. */
export const LEGACY_CLASS_IDS: Readonly<Record<string, InstrumentClassId>> = { theremin: 'field' };

/** Add the classes an extension list contributes (the contribution registry's call; idempotent
 *  for the same class, an error for a different class under a taken id). */
export function registerInstrumentClasses(classes: readonly InstrumentClass[]): void {
  for (const c of classes) {
    const had = INSTRUMENT_CLASSES.find((k) => k.id === c.id);
    if (!had) INSTRUMENT_CLASSES.push(c);
    else if (had.label !== c.label || had.emoji !== c.emoji || had.colour !== c.colour || !!had.showEmpty !== !!c.showEmpty) throw new Error(`instrument class "${c.id}" is registered twice, differently`);
  }
}

/** Whether the Instruments view keeps class `id` listed while it is empty (its `showEmpty`). */
export function classShowsEmpty(id: InstrumentClassId): boolean {
  return INSTRUMENT_CLASSES.find((c) => c.id === id)?.showEmpty === true;
}

/** A current class id for `id`, following {@link LEGACY_CLASS_IDS}; `undefined` when unknown. */
export function normaliseClassId(id: string): InstrumentClassId | undefined {
  const current = LEGACY_CLASS_IDS[id] ?? id;
  return INSTRUMENT_CLASSES.some((c) => c.id === current) ? current : undefined;
}
