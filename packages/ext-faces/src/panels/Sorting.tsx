/**
 * Sorting (#385 E4, design C.3.2): the one editable carve, as a grid. Every hold is shown, in its
 * category (most typical first) or in one of the two bins, Neutral and Set aside, and every hold
 * can be moved three ways: dragged onto a category or a bin; selected (click, then more clicks)
 * and sent with a key (1-9 a category, N Neutral, S Set aside, Delete) or the bar's buttons; or
 * by the menu under its picture (the non-drag way WCAG 2.5.7 asks for). A category header
 * dragged onto another merges them; its menu merges or splits. k is re-cut with - / + or the
 * slider, never below the categories the player has pinned. Undo and redo (the buttons, or
 * Cmd/Ctrl-Z inside the grid) restore the exact previous categorizer.
 *
 * Quality (#385 E6, design C.3.2): every category carries a chip (three dots and a word: distinct,
 * ok, close to X, needs another hold; the numbers in its tooltip), a CLOSE category a hint in the
 * modality's words with a Merge, and a hold that sits nearer another category (or Neutral) than
 * its own a corner mark and a one-click "looks more like X" (a move, so a pin like any other).
 *
 * Rendering only: every edit is the session store's, and every move is a pin there.
 */
import { useWords } from './words';
import { useEffect, useState } from 'react';
import { ASIDE_BIN, NEUTRAL_BIN } from '@thoremin/sdk/enroll/categorizer';
import { NEW_CATEGORY } from '@thoremin/sdk/enroll/sorting';
import { NEUTRAL_TARGET, QUALITY_DEFAULTS, type CategoryQuality } from '@thoremin/sdk/enroll/quality';
import { reproducibilityOf, reproducibilityScore } from '@thoremin/sdk/enroll/quiz';
import { everydayFlags } from '@thoremin/sdk/enroll/everyday';
import type { FaceSessionState } from '../app/sessionStore';
import type { CarvedCategory, SortingView } from '../lib/carving';

const btn = 'rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/90 transition hover:bg-white/20 disabled:opacity-40';
const hint = 'text-[11px] leading-relaxed text-white/60';

export const SORTING_DEFAULTS = {
  /** Holds shown per category or bin before "+n". */
  collapsedHolds: 8,
  /** The largest k the slider offers. */
  maxSliderK: 12,
  /** Category keys: 1..9. */
  keyedCategories: 9,
} as const;

/** The data a dragged hold or category carries. */
const DRAG_HOLDS = 'application/x-thoremin-holds';
const DRAG_CATEGORY = 'application/x-thoremin-category';

/** What the menu under a hold offers besides the categories. */
const DELETE = '+delete';

/** `text` with its first letter in capitals. */
const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const sourceText = (c: CarvedCategory, one: string): string =>
  c.source === 'edited'
    ? 'your name'
    : c.source === 'neutral'
      ? `mostly your resting ${one}`
      : c.source === 'matched'
        ? `the general model reads "${c.matched}"`
        : c.source === 'kept'
          ? 'saved name'
          : 'no general label fits';

interface HoldProps {
  key?: number;
  index: number;
  id: string;
  url?: string;
  label: string;
  first: boolean;
  pinned: boolean;
  selected: boolean;
  place: string;
  view: SortingView;
  toggle: (id: string) => void;
  dragIds: (id: string) => string[];
  send: (ids: readonly string[], to: string) => void;
}

/** A place's name in the grid: a category's label, or a bin's. */
function placeName(view: SortingView, place: string): string {
  if (place === NEUTRAL_TARGET) return 'Neutral';
  if (place === ASIDE_BIN) return 'Set aside';
  const c = view.categories.find((x) => x.id === place);
  return c ? c.label || c.id : place;
}

function Hold({ index, id, url, label, first, pinned, selected, place, view, toggle, dragIds, send }: HoldProps) {
  const looksLike = view.suspects.get(index);
  return (
    <figure
      className={`relative flex w-16 shrink-0 flex-col items-center gap-0.5 rounded ${selected ? 'ring-2 ring-emerald-300' : ''}`}
      data-face-hold={id}
      data-selected={selected || undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_HOLDS, JSON.stringify(dragIds(id)));
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <button type="button" aria-pressed={selected} aria-label={`Select ${label}`} className="block" onClick={() => toggle(id)}>
        {url ? (
          <img src={url} alt={label} data-face-still className="h-12 w-16 rounded object-cover" draggable={false} />
        ) : (
          <div className="flex h-12 w-16 items-center justify-center rounded bg-white/5 text-[9px] text-white/30">no picture</div>
        )}
      </button>
      {pinned && (
        <span className="absolute right-0.5 top-0.5 rounded bg-black/60 px-0.5 text-[8px] text-emerald-200" title="You placed this one: a re-cut keeps it here">
          pin
        </span>
      )}
      {looksLike && (
        <span className="absolute left-0.5 top-0.5 rounded bg-amber-500/80 px-0.5 text-[8px] font-bold text-black" title={`Nearer ${placeName(view, looksLike)} than its own`} data-face-suspect={looksLike}>
          ?
        </span>
      )}
      <figcaption className="text-[9px] text-white/40">{first ? 'most typical' : 'less typical'}</figcaption>
      {looksLike && (
        <button
          type="button"
          className="w-16 truncate rounded bg-amber-500/15 px-0.5 text-[9px] text-amber-100 hover:bg-amber-500/30"
          data-face-accept={looksLike}
          title={`Looks more like ${placeName(view, looksLike)}: move it there`}
          onClick={() => send([id], looksLike)}
        >
          {`like ${placeName(view, looksLike)}?`}
        </button>
      )}
      <select
        aria-label={`Move ${label}`}
        data-face-move={index}
        value={place}
        onChange={(e) => send([id], e.target.value)}
        className="w-16 rounded bg-white/10 text-[9px] text-white/70"
      >
        {view.categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label || c.id}
          </option>
        ))}
        <option value={NEUTRAL_BIN}>Neutral</option>
        <option value={ASIDE_BIN}>Set aside</option>
        <option value={NEW_CATEGORY}>New category</option>
        <option value={DELETE}>Delete</option>
      </select>
    </figure>
  );
}

interface StripProps {
  holds: readonly number[];
  label: string;
  place: string;
  grid: GridApi;
}

/** A category's or a bin's holds, collapsed past {@link SORTING_DEFAULTS.collapsedHolds}. */
function Strip({ holds, label, place, grid }: StripProps) {
  const [open, setOpen] = useState(false);
  const shown = open ? holds : holds.slice(0, SORTING_DEFAULTS.collapsedHolds);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((i, j) => (
        <Hold
          key={i}
          index={i}
          id={grid.ids[i]}
          url={grid.s.thumbs[i]}
          label={`${label}, hold ${j + 1}`}
          first={j === 0}
          pinned={grid.view.pinned.has(i)}
          selected={grid.selected.has(grid.ids[i])}
          place={place}
          view={grid.view}
          toggle={grid.toggle}
          dragIds={grid.dragIds}
          send={grid.send}
        />
      ))}
      {holds.length > shown.length && (
        <button type="button" className={btn} onClick={() => setOpen(true)}>
          +{holds.length - shown.length}
        </button>
      )}
    </div>
  );
}

/** Drop handlers for a category or a bin: holds move there; a category dropped merges into it
 *  (or into Neutral). */
function dropTarget(grid: GridApi, to: string) {
  return {
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const holds = e.dataTransfer?.getData(DRAG_HOLDS);
      const category = e.dataTransfer?.getData(DRAG_CATEGORY);
      if (holds) grid.send(JSON.parse(holds) as string[], to);
      // A category dropped on Neutral merges into it (#444); on Set aside, nothing.
      else if (category && category !== to && to !== ASIDE_BIN) grid.s.merge(category, to);
    },
  };
}

const GRADE_TEXT = {
  distinct: 'distinct',
  ok: 'ok',
  thin: 'needs another hold',
} as const;

/** The chip: three dots and a word, the numbers in the tooltip. */
function QualityChip({ q, view }: { q: CategoryQuality; view: SortingView }) {
  const word = q.grade === 'close' ? `close to ${placeName(view, q.closeTo ?? q.nearest ?? '')}` : GRADE_TEXT[q.grade];
  const colour = q.grade === 'distinct' ? 'text-emerald-300' : q.grade === 'ok' ? 'text-white/70' : 'text-amber-300';
  const numbers = [
    q.nearest === null ? 'No other category to be confused with.' : `Nearest: ${placeName(view, q.nearest)}, ${Number.isFinite(q.ratio) ? q.ratio.toFixed(1) : 'many'} times its own spread apart (below ${QUALITY_DEFAULTS.closeRatio} is close).`,
    q.sloppy && q.outside !== null ? `${Math.round(q.outside * 100)}% of its recorded frames fall outside what any category accepts, so it will often read as none of these: hold it more steadily, or record more of it.` : '',
    q.looAccuracy === null ? 'One hold: record another to measure it.' : `${Math.round(q.looAccuracy * 100)}% of its holds sit nearest their own category${q.leaksTo ? `; the others nearest ${placeName(view, q.leaksTo)}` : ''}.`,
  ].filter(Boolean).join(' ');
  return (
    <span className={`shrink-0 whitespace-nowrap text-[10px] ${colour}`} title={numbers} data-face-quality={q.grade} {...(q.sloppy ? { 'data-face-sloppy': '' } : {})}>
      <span aria-hidden="true">{'●'.repeat(q.dots) + '○'.repeat(3 - q.dots)}</span> {word}
      {q.sloppy && <span className="text-amber-300">, often none of these</span>}
    </span>
  );
}

/**
 * What the player's checks said of this category (#385 E7), beside the quality chip: the last
 * quiz (how often it was found again: "found 1 of 2") and, if it fired by accident in the last
 * everyday check, how often. Shown only while the category is the one checked (same id and name).
 */
function ChecksChip({ c, s }: { c: CarvedCategory; s: FaceSessionState }) {
  const r = reproducibilityOf(s.checks.quiz, c);
  const everyday = s.checks.everyday;
  const flag = everyday && (everyday.labels[c.id] ?? '').trim().toLowerCase() === c.label.trim().toLowerCase() ? everydayFlags(everyday).find((f) => f.categoryId === c.id) : undefined;
  if (!r && !flag) return null;
  const score = r ? reproducibilityScore(r) : 1;
  const colour = flag || score < 0.5 ? 'text-amber-300' : score < 1 ? 'text-white/70' : 'text-emerald-300';
  const title = [
    r ? `Quiz: asked ${r.asked}, found ${r.hits} in time${r.slow ? `, ${r.slow} slowly` : ''}${r.misses ? `, missed ${r.misses}${r.confusedWith ? ` (read as ${placeName(s.view as SortingView, r.confusedWith)})` : ''}` : ''}.` : '',
    flag ? `Fired ${flag.fires} times by accident in the everyday check (${flag.perMinute.toFixed(1)} a minute): make it bigger, set a larger size, or merge it.` : '',
  ].filter(Boolean).join(' ');
  return (
    <span className={`shrink-0 whitespace-nowrap text-[10px] ${colour}`} title={title} data-face-checks={c.id}>
      {r ? `found ${r.hits + r.slow} of ${r.asked}` : ''}
      {r && flag ? ', ' : ''}
      {flag ? `fired ${flag.fires}x` : ''}
    </span>
  );
}

function CategoryRow({ c, n, grid }: { key?: string; c: CarvedCategory; n: number; grid: GridApi }) {
  const w = useWords();
  const [text, setText] = useState(c.label);
  useEffect(() => setText(c.label), [c.label]);
  const commit = () => {
    if (text.trim() && text.trim() !== c.label) grid.s.rename(c.id, text);
    else setText(c.label);
  };
  const others = grid.view.categories.filter((x) => x.id !== c.id);
  const quality = grid.view.quality.categories.find((q) => q.id === c.id);
  const hint = grid.view.hints.get(c.id);
  return (
    <li data-face-category={c.id} className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2" {...dropTarget(grid, c.id)}>
      <div
        className="flex items-center gap-2"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_CATEGORY, c.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
      >
        <span className="w-4 shrink-0 text-center text-[10px] font-bold text-white/50" title={n <= SORTING_DEFAULTS.keyedCategories ? `Press ${n} to move the selected holds here` : undefined}>
          {n}
        </span>
        <input
          aria-label={`Name of ${c.label}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setText(c.label);
          }}
          className="min-w-0 flex-1 rounded bg-white/10 px-2 py-0.5 text-xs font-semibold text-white outline-none focus:bg-white/20"
        />
        <span className="shrink-0 text-[10px] text-white/50">{c.size} held</span>
        {quality && <QualityChip q={quality} view={grid.view} />}
        <ChecksChip c={c} s={grid.s} />
        <select
          aria-label={`Change ${c.label}`}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'split') grid.s.split(c.id);
            else if (v.startsWith('merge:')) grid.s.merge(c.id, v.slice('merge:'.length));
          }}
          className="w-14 shrink-0 rounded bg-white/10 text-[10px] text-white/70"
        >
          <option value="">More</option>
          <option value="split" disabled={c.size < 2}>
            Split in two
          </option>
          {others.map((o) => (
            <option key={o.id} value={`merge:${o.id}`}>{`Merge into ${o.label || o.id}`}</option>
          ))}
          {others.length > 0 && <option value={`merge:${NEUTRAL_BIN}`}>Merge into Neutral</option>}
        </select>
      </div>
      <p className="text-[10px] text-white/40">{sourceText(c, w.one)}</p>
      {hint && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100" data-face-hint={c.id}>
          <span className="min-w-0 flex-1">{hint.text}</span>
          {hint.other !== NEUTRAL_TARGET && grid.s.working !== null && (
            <button type="button" className={btn} onClick={() => grid.s.merge(c.id, hint.other)}>
              {`Merge with ${placeName(grid.view, hint.other)}`}
            </button>
          )}
          {grid.s.working !== null && c.label.trim() !== '' && (
            // Design C.4.8 (#435): see what tells them apart, rehearse it, then record more of it.
            <button type="button" className={btn} data-face-hint-bars={c.id} onClick={() => grid.s.showOnBars(c.id)}>
              Show me on the bars
            </button>
          )}
          {grid.s.working !== null && c.label.trim() !== '' && (
            <button type="button" className={btn} data-face-hint-more={c.id} onClick={() => grid.s.recordMore(c.id)}>
              {`Record more ${c.label}`}
            </button>
          )}
        </div>
      )}
      <Strip holds={c.exemplars.map((e) => e.index)} label={c.label} place={c.id} grid={grid} />
    </li>
  );
}

function Bin({ which, grid }: { which: typeof NEUTRAL_BIN | typeof ASIDE_BIN; grid: GridApi }) {
  const w = useWords();
  const neutral = which === NEUTRAL_BIN;
  const bin = neutral ? grid.view.neutral : grid.view.aside;
  const taught = grid.view.neutralTrained;
  const title = neutral ? `Neutral: ${taught ? 'plays nothing' : 'not trained on'}` : 'Set aside: not used, not sure yet';
  const says = neutral
    ? taught
      ? `${cap(w.many)} that mean nothing (your resting ${w.one}, and any you put here). A ${w.one} like these reads as none of these.`
      : grid.view.strangers === 'neutral'
        ? `Not trained on (this categorizer was made before Neutral was taught): only a ${w.one} far from every category reads as none of these.`
        : `Not trained on (this categorizer was made before Neutral was taught): a ${w.one} like these still reads as its nearest category.`
    : 'Kept in the categorizer, not trained on. Move them back any time.';
  return (
    <div {...(neutral ? { 'data-face-neutral': true } : { 'data-face-aside': true })} className="space-y-1.5 rounded-lg border border-dashed border-white/15 p-2" {...dropTarget(grid, which)}>
      <p className="text-xs font-semibold text-white/70">
        {title} <span className="font-normal text-white/40">{`(${bin.count}${neutral ? ', key N' : ', key S'})`}</span>
      </p>
      <p className="text-[10px] text-white/40">{bin.count === 0 ? `Empty. Drag holds here, or select them and press ${neutral ? 'N' : 'S'}.` : says}</p>
      {neutral && !taught && bin.count > 0 && (
        <button type="button" data-faces-teach-neutral className="rounded-md border border-sky-400/40 bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-100 hover:bg-sky-500/25" onClick={() => grid.s.teachNeutral()}>
          Teach Neutral from these
        </button>
      )}
      {bin.count > 0 && <Strip holds={bin.exemplars} label={neutral ? 'neutral' : 'set aside'} place={which} grid={grid} />}
    </div>
  );
}

/** What the rows share: the store, the view, the selection and how holds are sent. */
interface GridApi {
  s: FaceSessionState;
  view: SortingView;
  ids: readonly string[];
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  dragIds: (id: string) => string[];
  send: (ids: readonly string[], to: string) => void;
}

function KControl({ s, view }: { s: FaceSessionState; view: SortingView }) {
  const w = useWords();
  if (view.maxK === 0) return null;
  if (!view.recutable) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-white/80">
        <span className="flex-1">{`How many: ${view.k}. Too many holds to re-cut here: merge, split or move instead.`}</span>
        <button type="button" className={btn} aria-label="Undo" disabled={s.history.undo === 0} onClick={() => s.undo()}>
          Undo
        </button>
        <button type="button" className={btn} aria-label="Redo" disabled={s.history.redo === 0} onClick={() => s.redo()}>
          Redo
        </button>
      </div>
    );
  }
  const max = Math.max(view.minK, Math.min(view.maxK, SORTING_DEFAULTS.maxSliderK));
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[11px] text-white/80">
        <span className="w-20 shrink-0">How many: {view.k}</span>
        <button type="button" className={btn} aria-label="One fewer category" disabled={view.k <= view.minK} onClick={() => s.setK(view.k - 1)}>
          -
        </button>
        <input
          type="range"
          aria-label="Number of categories"
          min={view.minK}
          max={max}
          step={1}
          value={Math.min(view.k, max)}
          onChange={(e) => s.setK(Number(e.target.value))}
          className="min-w-0 flex-1"
        />
        <button type="button" className={btn} aria-label="One more category" disabled={view.k >= view.maxK} onClick={() => s.setK(view.k + 1)}>
          +
        </button>
        <button type="button" className={btn} aria-label="Undo" title="Undo (Cmd/Ctrl-Z)" disabled={s.history.undo === 0} onClick={() => s.undo()}>
          Undo
        </button>
        <button type="button" className={btn} aria-label="Redo" title="Redo (Cmd/Ctrl-Shift-Z)" disabled={s.history.redo === 0} onClick={() => s.redo()}>
          Redo
        </button>
      </div>
      <p className={hint}>
        {`Suggested: ${view.suggestedK}. A suggestion from how the ${w.many} group, not a rule. `}
        {view.minK > 1 && `At least ${view.minK}: you placed holds in ${view.minK} categories, and a re-cut keeps them. `}
        {view.k !== view.suggestedK && view.suggestedK > 0 && (
          <button type="button" className="underline hover:text-white" onClick={() => s.setK(view.suggestedK)}>
            Use {view.suggestedK}
          </button>
        )}
      </p>
    </div>
  );
}

/** The sorting grid over the working categorizer (or, with nothing carved, its neutral holds). */
export function Sorting({ s }: { s: FaceSessionState }) {
  const view = s.view as SortingView;
  const ids = view.ids;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // A selection names holds by id: drop the ones an edit removed.
  useEffect(() => {
    const have = new Set(s.working?.samples.map((x) => x.id) ?? []);
    setSelected((cur) => (([...cur].every((id) => have.has(id)) ? cur : new Set([...cur].filter((id) => have.has(id))))));
  }, [s.working]);
  const editable = s.working !== null;
  const send = (holds: readonly string[], to: string) => {
    if (!editable || holds.length === 0) return;
    const ok = to === DELETE ? s.deleteHolds(holds) : s.moveHolds(holds, to);
    if (ok) setSelected(new Set());
  };
  const grid: GridApi = {
    s,
    view,
    ids,
    selected,
    toggle: (id) =>
      setSelected((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    // Dragging a selected hold drags the whole selection; an unselected one goes alone.
    dragIds: (id) => (selected.has(id) ? [...selected] : [id]),
    send,
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLInputElement | null;
    // Typing in a name or a menu is not sorting; the k slider is (Cmd-Z after a drag undoes it).
    const typing = t && (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range'));
    if (typing) return;
    const mod = e.metaKey || e.ctrlKey;
    let handled = true;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      if (e.shiftKey) s.redo();
      else s.undo();
    } else if (mod && (e.key === 'y' || e.key === 'Y')) s.redo();
    else if (mod) handled = false;
    else if (t && t.tagName === 'INPUT') handled = false;
    else if (e.key === 'Escape' && selected.size > 0) setSelected(new Set());
    else if (selected.size === 0) handled = false;
    else if (/^[1-9]$/.test(e.key) && view.categories[Number(e.key) - 1]) send([...selected], view.categories[Number(e.key) - 1].id);
    else if (e.key === 'n' || e.key === 'N') send([...selected], NEUTRAL_BIN);
    else if (e.key === 's' || e.key === 'S') send([...selected], ASIDE_BIN);
    else if (e.key === 'Delete' || e.key === 'Backspace') send([...selected], DELETE);
    else handled = false;
    // Inside the grid these keys are the grid's, not the instrument's (the app's own Cmd-Z undoes dials).
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  return (
    <div className="space-y-2 outline-none" tabIndex={0} onKeyDown={onKeyDown} data-faces-sorting aria-label="Sorting: select holds, then press a category's number, N, S or Delete">
      {editable && <KControl s={s} view={view} />}
      {editable && (
        <p className={hint}>Drag a picture onto a category or a bin, or select pictures and press a category's number, N, S or Delete. Every move is kept when you change how many.</p>
      )}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-100" data-faces-selection>
          <span>{`Selected: ${selected.size}. Move to`}</span>
          {view.categories.map((c, i) => (
            <button key={c.id} type="button" className={btn} onClick={() => send([...selected], c.id)} title={c.label}>
              {i < SORTING_DEFAULTS.keyedCategories ? `${i + 1} ${c.label}` : c.label}
            </button>
          ))}
          <button type="button" className={btn} onClick={() => send([...selected], NEW_CATEGORY)}>
            New category
          </button>
          <button type="button" className={btn} onClick={() => send([...selected], NEUTRAL_BIN)}>
            Neutral (N)
          </button>
          <button type="button" className={btn} onClick={() => send([...selected], ASIDE_BIN)}>
            Set aside (S)
          </button>
          <button type="button" className={btn} onClick={() => send([...selected], DELETE)}>
            Delete
          </button>
          <button type="button" className={btn} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {view.categories.map((c, i) => (
          <CategoryRow key={c.id} c={c} n={i + 1} grid={grid} />
        ))}
      </ul>
      <Bin which={NEUTRAL_BIN} grid={grid} />
      {editable && <Bin which={ASIDE_BIN} grid={grid} />}
    </div>
  );
}
