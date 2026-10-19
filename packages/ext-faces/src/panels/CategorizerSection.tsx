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
 * - **Shared** (#330 P5): the categorizers shipped for every player, listed under their own group
 *   (fetched when the section opens; ids `shared:<name>`). One plays untuned, the same for
 *   everyone; **Copy to my categorizers** saves it among the player's own and points the
 *   instrument at the copy (keeping the chords chosen, since the categories are the same), where
 *   the tool (Tools, Your faces) tunes it and retrains it on their face.
 *
 * Every write goes through the dial commands (the single write path, #87); the section reads the
 * resolved categorizer from {@link useCategorizerPlay}, which the extension's mount effect keeps.
 */
import { useEffect, useRef, useState } from 'react';
import { TARGET_CHOICES, targetChoice } from '@thoremin/sdk/harmony/target';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { dispatchDialPatch, dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import { DEFAULT_EXPRESSION_TO_DEGREE, SILENCE_DEGREE, type ExpressionLabel } from '@thoremin/sdk/music/expression';
import type { NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import { retryCategorizerPlay, useCategorizerPlay } from '../app/categorizerPlay';
import { createFaceModelStore, onFaceModelsChanged, withChangeNotice } from '../app/models';
import { copySharedToMine, sharedSource, type SharedSource } from '../app/sharedModels';
import { isSharedId, sharedId, sharedName, type SharedEntry } from '../lib/shared';
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

/** The shipped shared categorizers (an empty list until the index is read, or without one). */
function useSharedCategorizers(source: SharedSource): { entries: readonly SharedEntry[]; relist: () => void } {
  const [entries, setEntries] = useState<readonly SharedEntry[]>([]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void source.list().then((l) => live && setEntries(l.entries), () => undefined);
    return () => {
      live = false;
    };
  }, [source, attempt]);
  return { entries, relist: () => setAttempt((n) => n + 1) };
}

export interface CategorizerSectionProps {
  /** Where shared categorizers come from (the page's shipped ones by default; tests inject). */
  shared?: SharedSource;
}

export default function CategorizerSection({ shared: source = sharedSource() }: CategorizerSectionProps = {}) {
  const { state } = useDialsSettings();
  const v = state.effective as Record<string, unknown>;
  const dial = (v.faceCategorizer as FaceCategorizerDial | undefined) ?? DEFAULT_FACE_CATEGORIZER;
  const faceMapping = (v['face.mapping'] as string | undefined) ?? 'none';
  const expressionDegrees = (v['faceExpr.degrees'] as Record<string, number> | undefined) ?? {};
  const expressionTargets = (v['faceExpr.targets'] as Record<string, string> | undefined) ?? {};
  const saved = useSavedCategorizers();
  const { entries: shared, relist } = useSharedCategorizers(source);
  const play = useCategorizerPlay();
  const [copying, setCopying] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const chosen = dial.id;
  // The latest choice, for a copy that finishes after the player chose something else.
  const latest = useRef(chosen);
  latest.current = chosen;
  const chosenShared = isSharedId(chosen) ? shared.find((e) => sharedId(e.name) === chosen) ?? null : null;
  const known = chosen === GENERAL_CATEGORIZER || saved.some((s) => s.id === chosen) || chosenShared !== null;

  const copyToMine = async () => {
    setCopying(true);
    setCopyNotice(null);
    try {
      const copy = await copySharedToMine(chosen, source, withChangeNotice(createFaceModelStore()));
      if (!copy) {
        setCopyNotice('Could not read this shared categorizer.');
        return;
      }
      // Same categories in the same order: the chords chosen for the shared one still mean the same.
      // Only if the instrument still names the shared one: a choice made (or an instrument
      // switched to) while the copy was saving is the player's and is kept.
      if (latest.current === chosen) dispatchDialSetIn('faceCategorizer.id', copy.id);
      else {
        setCopyNotice(`Copied as "${copy.name}". It is in your categorizers.`);
        return;
      }
      setCopyNotice(`Copied as "${copy.name}". Tune it or retrain it on your face in Tools, then Your faces.`);
    } catch (err) {
      setCopyNotice(`Could not copy: ${err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err)}`);
    } finally {
      setCopying(false);
    }
  };
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
          {saved.length > 0 && (
            <optgroup label="Yours">
              {saved.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
          )}
          {shared.length > 0 && (
            <optgroup label="Shared">
              {shared.map((e) => (
                <option key={e.name} value={sharedId(e.name)}>{e.demo ? `${e.label} (demo)` : e.label}</option>
              ))}
            </optgroup>
          )}
          {!known && <option value={chosen}>{isSharedId(chosen) ? `${sharedName(chosen)} (shared, not available)` : `${chosen} (not on this device)`}</option>}
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
      {chosenShared && (
        <div className="space-y-1 rounded bg-white/5 px-2 py-1" data-testid="face-categorizer-shared">
          {chosenShared.description && <p className="text-[10px] leading-relaxed text-white/60">{chosenShared.description}</p>}
          {chosenShared.demo && (
            <p className="text-[10px] leading-relaxed text-amber-300/80">A demonstration of shared categorizers, not a model made to fit your face.</p>
          )}
          <p className="text-[10px] leading-relaxed text-white/40">
            Shared categorizers play untuned, the same for everyone. Copy it to tune it for your room and camera, or to retrain it on your face.
          </p>
          <button
            type="button"
            className="rounded bg-white/10 px-2 py-0.5 text-[11px] hover:bg-white/20 disabled:opacity-50"
            disabled={copying}
            onClick={() => void copyToMine()}
          >
            Copy to my categorizers
          </button>
        </div>
      )}
      {copyNotice && (
        <p className="text-[10px] leading-relaxed text-white/60" role="status">
          {copyNotice}
        </p>
      )}
      {play.phase === 'loading' && <p className="text-[10px] text-white/50">Loading your categorizer…</p>}
      {play.phase === 'missing' && (
        <p className="text-[10px] leading-relaxed text-amber-300/80">
          {isSharedId(chosen)
            ? 'This instrument names a shared categorizer this app could not read, so the general model plays.'
            : 'This instrument names a categorizer this device does not have, so the general model plays.'}
          {isSharedId(chosen) && (
            <button
              type="button"
              className="ml-2 rounded bg-white/10 px-2 py-0.5 text-[11px] text-white/80 hover:bg-white/20"
              onClick={() => {
                relist();
                retryCategorizerPlay();
              }}
            >
              Try again
            </button>
          )}
        </p>
      )}

      {play.phase === 'ready' && play.id === chosen && (
        <div className="space-y-1" data-testid="face-categorizer-degrees">
          <p className="text-[10px] leading-relaxed text-white/40">
            The chord each of your faces plays. Auto plays what this instrument gives the expression the face stands in for. The choices follow the
            category's number: one you named or placed faces in keeps its number when the categorizer is re-cut, the others are numbered again, so check them after a re-cut.
          </p>
          {play.categories.map((c) => {
            const slot = CATEGORY_SLOTS.includes(c.id) ? c.id : null;
            const own = slot ? (dial.degrees[slot] ?? AUTO_DEGREE) : AUTO_DEGREE;
            const ownTarget = slot ? targetChoice((dial.targets as Record<string, string> | undefined)?.[slot]) : '';
            // With no target and an Auto degree, the category does what its stand-in expression does.
            const inherited = own === AUTO_DEGREE ? targetChoice(expressionTargets[c.standsFor]) : '';
            const inheritedLabel = TARGET_CHOICES.find((o) => o.value === inherited)?.label;
            return (
              <div key={c.id} className="flex items-center justify-between gap-2">
                <span className="flex-1 truncate" title={`stands in for ${c.standsFor}`}>
                  {c.name} <span className="text-white/30">({c.standsFor})</span>
                </span>
                <select
                  className={selectCls}
                  aria-label={`Chord for ${c.name}`}
                  value={own}
                  disabled={!slot || ownTarget !== ''}
                  title={ownTarget !== '' ? 'Its target decides the chord' : undefined}
                  onChange={(e) => slot && dispatchDialSetIn(`faceCategorizer.degrees.${slot}`, Number(e.target.value))}
                >
                  <option value={AUTO_DEGREE}>{`Auto (${degreeName(standInDegree(c.standsFor))})`}</option>
                  <option value={SILENCE_DEGREE}>Silence</option>
                  {DEGREES.map((d) => (
                    <option key={d} value={d}>{`Degree ${d + 1}`}</option>
                  ))}
                </select>
                <select
                  className={selectCls}
                  aria-label={`What ${c.name} does`}
                  data-category-target={c.id}
                  value={ownTarget}
                  disabled={!slot}
                  title="What this category does: play its chord, or move from the chord in force, choose a function, or add the seventh while held"
                  onChange={(e) => slot && void dispatchDialSetIn(`faceCategorizer.targets.${slot}`, e.target.value)}
                >
                  {TARGET_CHOICES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value === '' && inherited !== '' ? `as ${c.standsFor}: ${inheritedLabel}` : o.label}
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
