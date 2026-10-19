/**
 * The instrument editor's "Categorizer chords" section (#450): which of the player's saved
 * hand-shape or pose categorizers plays chords, and the chord each of its categories plays. The
 * choice is one `dial.patch` (the id, every slot back to Auto); a degree is a `dial.setIn` by the
 * category's slot (`categorizerChords.degrees.cat-1`), the single write path. The section reads the
 * resolved categorizer from {@link useCategorizerChords}, which the extension's mount effect keeps.
 */
import { useEffect, useState } from 'react';
import { TARGET_CHOICES, targetChoice } from '@thoremin/sdk/harmony/target';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { dispatchDialPatch, dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import type { NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import { createCategorizerStore } from '@thoremin/sdk-ui/enroll/categorizers';
import { useCategorizerChords } from '../app/categorizerChords';
import { onFaceModelsChanged } from '../app/models';
import { CHORD_MODALITY } from '../lib/categorizerChord';
import { AUTO_DEGREE, CATEGORY_SLOTS, chooseCategorizerChordsWrites, DEFAULT_CATEGORIZER_CHORDS, ORDER_DEGREES, type CategorizerChordsDial } from '../schema';

const DEGREES = [0, 1, 2, 3, 4, 5, 6] as const;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;
const degreeName = (d: number): string => (d < 0 ? 'silence' : `degree ${ROMAN[d] ?? d + 1}`);

/** The player's saved hand-shape and pose categorizers, kept fresh across saves and deletes. */
export function useSavedChordCategorizers(): { hand: NamedSummary[]; body: NamedSummary[] } {
  const [saved, setSaved] = useState<{ hand: NamedSummary[]; body: NamedSummary[] }>({ hand: [], body: [] });
  useEffect(() => {
    const hand = createCategorizerStore(CHORD_MODALITY.hand);
    const body = createCategorizerStore(CHORD_MODALITY.body);
    let live = true;
    const refresh = () =>
      void Promise.all([hand.list(), body.list()]).then(
        ([h, b]) => live && setSaved({ hand: h, body: b }),
        () => undefined,
      );
    refresh();
    const off = onFaceModelsChanged(refresh);
    return () => {
      live = false;
      off();
    };
  }, []);
  return saved;
}

export default function CategorizerChordsSection() {
  const { state } = useDialsSettings();
  const dial = ((state.effective as Record<string, unknown>).categorizerChords as CategorizerChordsDial | undefined) ?? DEFAULT_CATEGORIZER_CHORDS;
  const saved = useSavedChordCategorizers();
  const play = useCategorizerChords();
  const known = dial.id === '' || saved.hand.some((s) => s.id === dial.id) || saved.body.some((s) => s.id === dial.id);
  return (
    <div className="space-y-2 text-[11px] text-white/80" data-categorizer-chords-section>
      <label className="flex items-center gap-2">
        <span>Chords from</span>
        <select className={selectCls} aria-label="Categorizer chords" value={dial.id} onChange={(e) => dispatchDialPatch(chooseCategorizerChordsWrites(e.target.value))}>
          <option value="">nothing (off)</option>
          {saved.hand.length > 0 && (
            <optgroup label="Your hand shapes">
              {saved.hand.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
          {saved.body.length > 0 && (
            <optgroup label="Your poses">
              {saved.body.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
          {!known && <option value={dial.id}>{dial.id} (not on this device)</option>}
        </select>
      </label>
      {saved.hand.length === 0 && saved.body.length === 0 && <p className="text-white/50">Nothing saved yet: record some in Tools, Your hand shapes or Your poses.</p>}
      {play.phase === 'loading' && <p className="text-white/50">Loading…</p>}
      {play.phase === 'missing' && <p className="text-amber-300/80">This instrument names a categorizer this device does not have, so it plays no chords.</p>}
      {play.phase === 'ready' && play.id === dial.id && (
        <div className="space-y-1" data-categorizer-chords-degrees>
          <p className="text-[10px] leading-relaxed text-white/40">
            The chord each category plays, on the chord scale. Auto goes by the category's place: I, IV, V, vi, ii, iii, vii. Neutral plays nothing.
          </p>
          {play.categories.map((c, i) => {
            const slot = CATEGORY_SLOTS.includes(c.id) ? c.id : null;
            const own = slot ? ((dial.degrees as Record<string, number>)[slot] ?? AUTO_DEGREE) : AUTO_DEGREE;
            return (
              <div key={c.id} className="flex items-center justify-between gap-2">
                <span className="flex-1 truncate">{c.name}</span>
                <select
                  className={selectCls}
                  aria-label={`Chord for ${c.name}`}
                  value={own}
                  disabled={!slot}
                  onChange={(e) => slot && void dispatchDialSetIn(`categorizerChords.degrees.${slot}`, Number(e.target.value))}
                >
                  <option value={AUTO_DEGREE}>{`Auto (${degreeName(ORDER_DEGREES[i % ORDER_DEGREES.length])})`}</option>
                  <option value={-1}>Silence</option>
                  {DEGREES.map((d) => (
                    <option key={d} value={d}>{`Degree ${ROMAN[d]}`}</option>
                  ))}
                </select>
                <select
                  className={selectCls}
                  aria-label={`What ${c.name} does`}
                  data-category-target={c.id}
                  value={slot ? targetChoice((dial.targets as Record<string, string> | undefined)?.[slot]) : ''}
                  disabled={!slot}
                  title="What this category does: play its chord, or move from the chord in force, choose a function, or add the seventh while held"
                  onChange={(e) => slot && void dispatchDialSetIn(`categorizerChords.targets.${slot}`, e.target.value)}
                >
                  {TARGET_CHOICES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One line: what plays the categorizer chords right now. */
export function CategorizerChordsReadout() {
  const play = useCategorizerChords();
  const text =
    play.phase === 'ready' ? `Chords from ${play.name}` : play.phase === 'loading' ? 'Loading…' : play.phase === 'missing' ? 'Not on this device: no chords' : 'No categorizer chords';
  return (
    <span className="text-[10px] text-white/50" data-categorizer-chords-readout>
      {text}
    </span>
  );
}
