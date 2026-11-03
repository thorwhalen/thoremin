/**
 * The Gestures section of the sorting grid (#754, design section 4): the working categorizer's
 * named MOVING gestures beside its held categories, and how to record one.
 *
 * Per gesture: its name (renamed in place), its repetitions as small path sketches (each with a
 * drop), its quality chip (the held categories' three dots and a word: distinct, ok, close to X,
 * repetitions differ, needs another repetition; the numbers in the tooltip), a one-click "Drop the
 * odd one" when a repetition is clearly unlike the others, Record more, Merge into another, and
 * Delete. No split (design section 4: a player who wants two gestures records two). Every edit is
 * one step of the grid's undo history.
 *
 * "Record a gesture" names a new one and starts its take; the take itself is `LiveGestureTake`, the
 * panel's live view while the store is in phase `gesture`.
 *
 * Rendering only: every action is the session store's (`../app/sessionStore/gesture.ts`), the
 * view is `../lib/gestureView.ts`.
 */
import { useMemo, useState } from 'react';
import { ProgressRing } from '@thoremin/sdk-ui/enroll/ProgressRing';
import type { FaceSessionState } from '../app/sessionStore';
import { gestureCards, type GestureCard, type TraceSketch } from '../lib/gestureView';
import { recordsGestures } from '../lib/gestureTake';

const btn = 'rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/90 transition hover:bg-white/20 disabled:opacity-40';
const hint = 'text-[11px] leading-relaxed text-white/60';

export const GESTURES_SECTION_DEFAULTS = {
  /** A sketch's side, in CSS pixels. */
  sketchPx: 44,
} as const;

/** One repetition's path, drawn in a small square, with a drop. */
function Sketch({ t, label, onDrop }: { key?: string; t: TraceSketch; label: string; onDrop: (() => void) | null }) {
  const px = GESTURES_SECTION_DEFAULTS.sketchPx;
  const pad = 0.1;
  const d = t.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(pad + x * (1 - 2 * pad)).toFixed(3)},${(pad + y * (1 - 2 * pad)).toFixed(3)}`).join(' ');
  return (
    <span className={`relative inline-block rounded border ${t.odd ? 'border-amber-300/70' : 'border-white/10'} bg-black/30`} data-gesture-trace={t.id} title={t.odd ? 'Unlike the other repetitions' : undefined}>
      <svg width={px} height={px} viewBox="0 0 1 1" role="img" aria-label={`A repetition of ${label}`}>
        <path d={d} fill="none" stroke={t.odd ? 'rgb(252 211 77)' : 'rgb(110 231 183)'} strokeWidth={0.04} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {onDrop && (
        <button type="button" aria-label={`Drop this repetition of ${label}`} onClick={onDrop} className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-black/70 text-[10px] leading-none text-white/70 hover:text-white">
          x
        </button>
      )}
    </span>
  );
}

function GestureRow({ g, others, s }: { key?: string; g: GestureCard; others: readonly GestureCard[]; s: FaceSessionState }) {
  const [text, setText] = useState(g.label);
  const [last, setLast] = useState(g.label);
  if (last !== g.label) {
    setLast(g.label);
    setText(g.label);
  }
  const commit = () => {
    if (text.trim() && text.trim() !== g.label) {
      if (!s.renameGesture(g.id, text)) setText(g.label);
    } else setText(g.label);
  };
  const colour = !g.chip ? 'text-white/50' : g.chip.grade === 'distinct' ? 'text-emerald-300' : g.chip.grade === 'ok' ? 'text-white/70' : 'text-amber-300';
  const several = g.traces.length > 1;
  return (
    <li data-gesture={g.id} className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2">
      <div className="flex items-center gap-2">
        <input
          aria-label={`Name of the gesture ${g.label}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setText(g.label);
          }}
          className="min-w-0 flex-1 rounded bg-white/10 px-2 py-0.5 text-xs font-semibold text-white outline-none focus:bg-white/20"
        />
        <span className="shrink-0 text-[10px] text-white/50">{`${g.traces.length} ${g.traces.length === 1 ? 'repetition' : 'repetitions'}`}</span>
        {g.chip && (
          <span className={`shrink-0 whitespace-nowrap text-[10px] ${colour}`} title={g.chip.title} data-gesture-quality={g.chip.grade}>
            <span aria-hidden="true">{'●'.repeat(g.chip.dots) + '○'.repeat(3 - g.chip.dots)}</span> {g.chip.word}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {g.traces.map((t) => (
          <Sketch key={t.id} t={t} label={g.label} onDrop={several ? () => s.dropGestureTrace(g.id, t.id) : null} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {g.odd && (
          <button type="button" className={btn} onClick={() => s.dropGestureTrace(g.id, g.odd!)}>
            Drop the odd one
          </button>
        )}
        <button type="button" className={btn} onClick={() => s.recordMoreGesture(g.id)}>
          Record more
        </button>
        {others.length > 0 && (
          <select
            aria-label={`Merge ${g.label} into`}
            value=""
            onChange={(e) => e.target.value && s.mergeGestures(g.id, e.target.value)}
            className="rounded bg-white/10 px-1 py-0.5 text-[10px] text-white/70"
          >
            <option value="">Merge into...</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <button type="button" className={btn} aria-label={`Delete the gesture ${g.label}`} onClick={() => s.deleteGesture(g.id)}>
          Delete
        </button>
      </div>
    </li>
  );
}

/** The section under the held categories (nothing for a modality that records no gestures). */
export function GesturesSection({ s }: { s: FaceSessionState }) {
  const [name, setName] = useState('');
  const working = s.working;
  // Keyed on the gestures alone (all `gestureCards` reads): a hold dragged in the grid makes a new
  // working categorizer, and must not rerun the gestures' leave-one-out quality.
  const gestures = working?.gestures;
  const cards = useMemo(() => gestureCards({ gestures }), [gestures]);
  if (!working || !recordsGestures(s.modality)) return null;
  const { part } = s.modality.words;
  const start = () => {
    if (s.recordGesture(name)) setName('');
  };
  return (
    <section aria-label="Gestures" className="space-y-2 border-t border-white/10 pt-2" data-gestures-section>
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/50">Gestures</h3>
      <p className={hint}>{`A gesture is a movement of your ${part} (a wave, a circle), not a shape you hold. Name it, rest, then repeat it a few times; bound to a command, it runs once each time you make it.`}</p>
      {cards.length > 0 && (
        <ul className="space-y-2">
          {cards.map((g) => (
            <GestureRow key={g.id} g={g} others={cards.filter((o) => o.id !== g.id)} s={s} />
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <input aria-label="Name of a new gesture" placeholder="Name a gesture (wave)" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-xs text-white outline-none focus:bg-white/20" />
        <button type="submit" className={btn} disabled={!name.trim()}>
          Record a gesture
        </button>
      </form>
    </section>
  );
}

/** The live view of a gesture take (phase `gesture`): the rest, then the prompt and the count. */
export function LiveGestureTake({ s }: { s: FaceSessionState }) {
  const g = s.gesture;
  if (!g) return null;
  return (
    <div className="space-y-2" data-gesture-take={g.step}>
      <p className="text-sm font-semibold text-white/90" role="status" aria-live="polite">
        {g.say || (g.step === 'rest' ? 'Hold still and relaxed, where you will make the gesture.' : `Do the ${g.name}.`)}
      </p>
      {g.step === 'rest' && g.restProgress !== null && <ProgressRing value={g.restProgress} label="Rest progress" words="Learning your rest" />}
      {g.step === 'gesture' && (
        <p className="text-[11px] text-white/70" data-gesture-count>
          {`${g.count} of ${g.target} repetitions of "${g.name}"`}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => s.finishGesture()}>
          Stop and keep them
        </button>
        <button type="button" className={btn} onClick={() => s.cancelGesture()}>
          Cancel
        </button>
      </div>
    </div>
  );
}
