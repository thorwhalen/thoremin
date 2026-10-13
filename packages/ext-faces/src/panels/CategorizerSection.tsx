/**
 * The instrument editor's "Face categorizer" section (#330 P4): which categorizer the face chords
 * read, and the chord each of its categories plays.
 *
 * - **Reads your face with**: the general model (the default) or one of the player's saved
 *   categorizers (Tools, then Your faces). Choosing one also turns the face chords on when the
 *   face plays nothing yet, and clears the per-category chords chosen for another categorizer:
 *   one `dial.patch`, so the switch is one undoable step.
 * - **Each category's chord**: Auto (the chord the instrument gives the expression the category
 *   stands in for, the one-to-one match with the general model) or a degree, or silence. A
 *   `dial.setIn` per category, by its slot (`faceCategorizer.degrees.cat-1`).
 *
 * Every write goes through the dial commands (the single write path, #87); the section reads the
 * resolved categorizer from {@link useCategorizerPlay}, which the extension's mount effect keeps.
 */
import { useEffect, useState } from 'react';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { dispatchDialPatch, dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import { DEFAULT_EXPRESSION_TO_DEGREE, SILENCE_DEGREE, type ExpressionLabel } from '@thoremin/sdk/music/expression';
import type { NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import { useCategorizerPlay } from '../app/categorizerPlay';
import { createFaceModelStore, onFaceModelsChanged } from '../app/models';
import { AUTO_DEGREE, CATEGORY_SLOTS, chooseCategorizerWrites, DEFAULT_FACE_CATEGORIZER, GENERAL_CATEGORIZER, type FaceCategorizerDial } from '../schema';

const DEGREES = [0, 1, 2, 3, 4, 5, 6] as const;
const degreeName = (d: number): string => (d < 0 ? 'silence' : `degree ${d + 1}`);

/** The player's saved categorizers, kept fresh across saves and deletes. */
function useSavedCategorizers(): NamedSummary[] {
  const [saved, setSaved] = useState<NamedSummary[]>([]);
  useEffect(() => {
    const store = createFaceModelStore();
    let live = true;
    const refresh = () => void store.list().then((s) => live && setSaved(s), () => undefined);
    refresh();
    const off = onFaceModelsChanged(refresh);
    return () => {
      live = false;
      off();
    };
  }, []);
  return saved;
}

export default function CategorizerSection() {
  const { state } = useDialsSettings();
  const v = state.effective as Record<string, unknown>;
  const dial = (v.faceCategorizer as FaceCategorizerDial | undefined) ?? DEFAULT_FACE_CATEGORIZER;
  const faceMapping = (v['face.mapping'] as string | undefined) ?? 'none';
  const expressionDegrees = (v['faceExpr.degrees'] as Record<string, number> | undefined) ?? {};
  const saved = useSavedCategorizers();
  const play = useCategorizerPlay();

  const chosen = dial.id;
  const known = chosen === GENERAL_CATEGORIZER || saved.some((s) => s.id === chosen);
  const standInDegree = (label: ExpressionLabel): number => expressionDegrees[label] ?? DEFAULT_EXPRESSION_TO_DEGREE[label];

  return (
    <div className="space-y-2 text-xs" data-testid="face-categorizer-section">
      <label className="flex items-center justify-between gap-2">
        Reads your face with
        <select
          className={selectCls}
          aria-label="Face categorizer"
          value={chosen}
          onChange={(e) => dispatchDialPatch(chooseCategorizerWrites(e.target.value, faceMapping))}
        >
          <option value={GENERAL_CATEGORIZER}>The general model</option>
          {saved.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
          {!known && <option value={chosen}>{`${chosen} (not on this device)`}</option>}
        </select>
      </label>

      {saved.length === 0 && (
        <p className="text-[10px] leading-relaxed text-white/40">
          Make your own in Tools, then Your faces: record your faces, carve them, save. They appear here.
        </p>
      )}
      {chosen !== GENERAL_CATEGORIZER && faceMapping !== 'chord' && (
        <p className="text-[10px] leading-relaxed text-amber-300/80">Your categorizer plays the face chords: set Face, then Mapping, to Expression chords.</p>
      )}
      {play.phase === 'loading' && <p className="text-[10px] text-white/50">Loading your categorizer…</p>}
      {play.phase === 'missing' && (
        <p className="text-[10px] leading-relaxed text-amber-300/80">
          This instrument names a categorizer this device does not have, so the general model plays.
        </p>
      )}

      {play.phase === 'ready' && play.id === chosen && (
        <div className="space-y-1" data-testid="face-categorizer-degrees">
          <p className="text-[10px] leading-relaxed text-white/40">
            The chord each of your faces plays. Auto plays what this instrument gives the expression the face stands in for.
          </p>
          {play.categories.map((c) => {
            const slot = CATEGORY_SLOTS.includes(c.id) ? c.id : null;
            const own = slot ? (dial.degrees[slot] ?? AUTO_DEGREE) : AUTO_DEGREE;
            return (
              <div key={c.id} className="flex items-center justify-between gap-2">
                <span className="flex-1 truncate" title={`stands in for ${c.standsFor}`}>
                  {c.name} <span className="text-white/30">({c.standsFor})</span>
                </span>
                <select
                  className={selectCls}
                  aria-label={`Chord for ${c.name}`}
                  value={own}
                  disabled={!slot}
                  onChange={(e) => slot && dispatchDialSetIn(`faceCategorizer.degrees.${slot}`, Number(e.target.value))}
                >
                  <option value={AUTO_DEGREE}>{`Auto (${degreeName(standInDegree(c.standsFor))})`}</option>
                  <option value={SILENCE_DEGREE}>Silence</option>
                  {DEGREES.map((d) => (
                    <option key={d} value={d}>{`Degree ${d + 1}`}</option>
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
