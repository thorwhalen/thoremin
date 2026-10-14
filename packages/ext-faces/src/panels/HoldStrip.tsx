/**
 * The live strip of captured holds (#404, design C.3.1 of #385): while a take captures (or is
 * paused), each hold is a card in the order it was made, saying what the online carve makes of
 * it so far ("new face" for the first of a group, "again: like #2" for a repeat), so the player
 * sees the vocabulary forming instead of a bare count. A card is tapped to name the hold (it then
 * goes to the category of that name, pinned, like a named burst) or to delete it (a sneeze, a look
 * away: it is left out of the carve). A coverage line lists the groups held only once ("#3: do it
 * again"), since a category is learned from two holds or more; while paused, a ghost card says
 * what the face being held would be, by the same carve.
 *
 * Words come from the modality (`one`: face / hand shape / pose), so the three tools share it.
 */
import { useState } from 'react';
import type { FaceSessionState, StripCardView } from '../app/sessionStore';
import { useWords } from './words';

const btn = 'rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/90 transition hover:bg-white/20 disabled:opacity-40';
const hint = 'text-[11px] leading-relaxed text-white/60';

/** What a card says the hold is, in the modality's words. */
export function cardWords(card: Pick<StripCardView, 'n' | 'like'>, one: string): string {
  return card.like === null ? `new ${one}` : `again: like #${card.like}`;
}

/** The coverage line: the groups held once, or null when every group is held twice or more. */
export function coverageWords(once: readonly number[]): string | null {
  if (once.length === 0) return null;
  const list = once.map((n) => `#${n}`).join(', ');
  return once.length === 1 ? `${list}: do it again, so it is learned.` : `${list}: do each of these again, so they are learned.`;
}

export function HoldStrip({ s }: { s: FaceSessionState }) {
  const { one, many } = useWords();
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const selected = open === null ? null : (s.strip.find((c) => c.n === open) ?? null);
  const coverage = coverageWords(s.stripOnce);
  if (s.strip.length === 0 && !s.ghost) return null;
  const choose = (card: StripCardView) => {
    if (open === card.n) {
      setOpen(null);
      return;
    }
    setOpen(card.n);
    setDraft(card.name ?? '');
  };
  /** Only a changed name is given: opening a card and leaving keeps a named burst's name. */
  const commitName = () => {
    if (selected && draft.trim() !== (selected.name ?? '')) s.nameHold(selected.n, draft);
  };
  return (
    <div className="space-y-1" data-faces-strip>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <ul className="flex gap-1.5" aria-label={`Held ${many} so far`}>
          {s.strip.map((card) => (
            <li key={card.n} className="shrink-0">
              <button
                type="button"
                aria-pressed={open === card.n}
                aria-label={`#${card.n}: ${cardWords(card, one)}${card.name ? `, named ${card.name}` : ''}. Tap to name or delete it.`}
                className={`flex w-[68px] shrink-0 flex-col items-center gap-0.5 rounded-md border p-1 text-center text-[10px] leading-tight transition ${
                  open === card.n ? 'border-emerald-300/70 bg-emerald-500/15' : card.like === null ? 'border-sky-300/40 bg-white/5' : 'border-white/15 bg-white/5'
                }`}
                onClick={() => choose(card)}
                data-faces-strip-card={card.n}
              >
                {card.thumb ? (
                  <img src={card.thumb} alt="" className="h-10 w-10 rounded object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded bg-white/10 font-bold text-white/70">{`#${card.n}`}</span>
                )}
                <span className="font-semibold text-white/90">{`#${card.n}`}</span>
                <span className={card.like === null ? 'text-sky-200' : 'text-white/60'}>{cardWords(card, one)}</span>
                {card.name && <span className="max-w-full truncate text-emerald-200">{card.name}</span>}
              </button>
            </li>
          ))}
        </ul>
        {s.ghost && (
          <div
            className="flex w-[68px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-amber-200/60 p-1 text-center text-[10px] leading-tight text-amber-100"
            role="status"
            aria-live="polite"
            data-faces-strip-ghost={s.ghost.like ?? 'new'}
          >
            <span className="font-semibold">would be:</span>
            <span>{s.ghost.like === null ? `a new ${one}` : `like #${s.ghost.like}`}</span>
          </div>
        )}
      </div>
      {selected && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-white/10 p-1.5" data-faces-strip-edit={selected.n}>
          <span className="text-[11px] font-semibold text-white/80">{`#${selected.n}`}</span>
          <input
            aria-label={`Name for #${selected.n}`}
            placeholder="Name (optional)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitName();
                setOpen(null);
              }
            }}
            className="w-32 rounded border border-white/15 bg-black/30 px-1.5 py-0.5 text-[11px] text-white placeholder:text-white/40"
          />
          <button
            type="button"
            className={btn}
            onClick={() => {
              commitName();
              setOpen(null);
            }}
          >
            Name it
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => {
              s.dropHold(selected.n);
              setOpen(null);
            }}
          >
            {`Delete #${selected.n}`}
          </button>
          <span className={hint}>{`A named ${one} goes to the category of that name, whatever is nearest.`}</span>
        </div>
      )}
      {coverage && (
        <p className={hint} data-faces-strip-coverage>
          {coverage}
        </p>
      )}
    </div>
  );
}
