/**
 * The strangers switch (#385 E5) and the grid's one-line summary, in the modality's words: what a
 * face (a hand shape, a pose) nobody taught reads as, and what Neutral holds. Moved out of
 * `./FaceSessionPanel.tsx` (#754), which imports them.
 */
import type { CategorizerStrangers } from '@thoremin/sdk/enroll/categorizer';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import type { ModalityWords } from '@thoremin/sdk/enroll/modality';
import type { SortingView } from '../lib/carving';

/** The strangers switch (#385 E5), stated plainly: what a face nobody taught reads as, in the
 *  modality's words (`one`: `face`, `hand shape`). Neutral itself is taught by example (the
 *  Neutral bin) in both settings. */
export function strangersText({ one, many }: Pick<ModalityWords, 'one' | 'many'>): Record<CategorizerStrangers, { title: string; says: string }> {
  return {
    neutral: {
      title: 'Neutral',
      says: `A ${one} far from every category you made reads as none of these, as your Neutral ${many} do.`,
    },
    nearest: {
      title: `The nearest ${one}`,
      says: `A ${one} you never taught reads as whichever of your categories it is closest to (or Neutral, when it is closer to your Neutral ${many}).`,
    },
  };
}

/** One line saying how many categories there are and what Neutral holds. */
export function strangersSummary(view: SortingView, { one, many }: Pick<ModalityWords, 'one' | 'many'> = faceModality.words): string {
  const held = view.neutral.count === 1 ? `1 held ${one}` : `${view.neutral.count} held ${many}`;
  const neutral =
    view.neutral.count === 0
      ? view.neutralKnown
        ? `Neutral is empty: drag the ${many} that should mean nothing into it.`
        : `There was no rest to tell neutral by, so Neutral is empty: drag your resting ${many} into it.`
      : view.neutralTrained
        ? `Neutral (${held}) plays nothing.`
        : `Neutral (${held}) is not trained on: this categorizer was made before Neutral was taught.`;
  return `${view.k} ${view.k === 1 ? 'category' : 'categories'}. ${neutral}`;
}

export function StrangersSwitch({ strangers, setStrangers, words }: { strangers: CategorizerStrangers; setStrangers: (m: CategorizerStrangers) => void; words: ModalityWords }) {
  const text = strangersText(words);
  return (
    <fieldset className="space-y-1" data-faces-strangers>
      <legend className="text-[10px] font-bold uppercase tracking-widest text-white/50">{`A ${words.one} I never taught reads as`}</legend>
      {(['neutral', 'nearest'] as const).map((m) => (
        <label key={m} className={`flex cursor-pointer gap-2 rounded-md border p-1.5 ${strangers === m ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10'}`}>
          <input type="radio" name="faces-strangers" value={m} checked={strangers === m} onChange={() => setStrangers(m)} className="mt-0.5" />
          <span>
            <span className="block text-[11px] font-semibold text-white/90">{text[m].title}</span>
            <span className="block text-[10px] leading-snug text-white/55">{text[m].says}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
