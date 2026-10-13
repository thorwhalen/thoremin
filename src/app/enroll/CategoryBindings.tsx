/**
 * CategoryBindings — the Gestures panel's "Your categories" section (#160): bind each
 * category the player trained to a command, and watch which one they are in.
 *
 * Lives in the Gestures tool, not the Trainer, for two reasons. The Trainer hushes the
 * instrument while it is open (so a binding could not be heard while it is being chosen),
 * and a category binding IS a gesture binding in every respect that matters: a discrete
 * recognised thing, hands-free, firing a command through the same picker
 * ({@link CommandBindingFields}). The Trainer's "Save and bind" button lands here.
 *
 * The section sits at the TOP of the panel, so *Save and bind* lands on it with no scroll.
 * The live readout polls `readCategoryLive()` at UI rate while the section is mounted,
 * like the trainer polls the live vector: the dispatcher computes it per tick (with binding
 * off too, while this panel is open), and nothing here needs frame-rate fidelity.
 */
import { useEffect, useState } from 'react';
import { categoryName } from '@thoremin/sdk/enroll';
import CommandBindingFields from '../CommandBindingFields';
import { useTools } from '../toolsStore';
import { MAX_CATEGORY_HOLD_MS, useCategoryBinding } from './categoryBinding';
import { readCategoryLive, type CategoryLive } from './categoryDispatch';

/** How often the readout refreshes (ms). */
const POLL_MS = 150;

function useCategoryLive(): CategoryLive | null {
  const [live, setLive] = useState<CategoryLive | null>(() => readCategoryLive());
  useEffect(() => {
    const id = setInterval(() => setLive(readCategoryLive()), POLL_MS);
    return () => clearInterval(id);
  }, []);
  return live;
}

export default function CategoryBindings() {
  const saved = useCategoryBinding((s) => s.saved);
  const active = useCategoryBinding((s) => s.active);
  const enabled = useCategoryBinding((s) => s.enabled);
  const holdMs = useCategoryBinding((s) => s.holdMs);
  const polled = useCategoryLive();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void useCategoryBinding
      .getState()
      .load()
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const openTrainer = () => useTools.getState().openTool('trainer');
  const model = active?.categories.model;
  // A reading taken with another set's model (the poll lags a switch) is not this set's.
  const live = polled && polled.model === model ? polled : null;

  return (
    <section aria-label="Your categories" className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70">Your categories</h3>
      {!loaded && saved.length === 0 ? null : saved.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-white/60">
          Nothing trained yet. Teach the instrument your own expressions or hand shapes in the{' '}
          <button type="button" onClick={openTrainer} className="underline decoration-white/30 hover:text-white">
            Trainer
          </button>
          , press <em>Save and bind</em>, and they appear here to bind like a gesture.
        </p>
      ) : (
        <>
          <p className="text-[11px] leading-relaxed text-white/60">
            Moving into a category runs its command once, after the hold. It runs again when you
            come back to it from another category or from rest. Nothing runs while a trainer is
            open, and the category you are already in when you turn this on does not fire.
          </p>
          <div className="flex items-center gap-2">
            <select
              aria-label="Active categories"
              value={active?.id ?? ''}
              onChange={(e) => void useCategoryBinding.getState().activate(e.target.value || null)}
              className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white/80"
            >
              <option value="">(none)</option>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {active && (
              <button
                type="button"
                aria-label={`Delete the saved categories ${active.name}`}
                onClick={() => {
                  if (window.confirm(`Delete "${active.name}" and its bindings?`)) void useCategoryBinding.getState().remove(active.id);
                }}
                className="rounded border border-white/10 px-2 py-1 text-[10px] text-white/50 transition hover:bg-white/5 hover:text-white/80"
              >
                Delete
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-[11px] text-white/80">
            <input
              type="checkbox"
              aria-label="Enable category commands"
              checked={enabled}
              onChange={(e) => useCategoryBinding.getState().setEnabled(e.target.checked)}
            />
            Enable category commands
          </label>
          <label className="block space-y-1">
            <span className="flex items-baseline gap-2 text-[11px] text-white/80">
              <span className="flex-1">Category hold</span>
              <span className="tabular-nums text-white/50">{holdMs} ms</span>
            </span>
            <input
              type="range"
              aria-label="Category hold"
              min={0}
              max={MAX_CATEGORY_HOLD_MS}
              step={50}
              value={holdMs}
              onChange={(e) => useCategoryBinding.getState().setHoldMs(Number(e.target.value))}
              className="w-full"
            />
          </label>
          {active && model && (
            <ul className="space-y-2">
              {model.categories.map((c, i) => {
                const name = categoryName(model, c.id);
                const inNow = live?.committed === c.id && live.scores.present;
                const score = live?.scores.present ? (live.scores.scores[i] ?? 0) : 0;
                return (
                  <li key={c.id} className="space-y-1 rounded-lg border border-white/10 bg-white/5 p-2">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`h-2 w-2 shrink-0 rounded-full ${inNow ? 'bg-emerald-400' : 'bg-white/15'}`}
                        title={inNow ? 'You are in this category' : 'Not in this category'}
                      />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-widest text-white/70">
                        {name}
                      </span>
                      <span aria-hidden className="h-1 w-16 overflow-hidden rounded bg-white/10">
                        <span className="block h-full bg-emerald-400/70" style={{ width: `${Math.round(score * 100)}%` }} />
                      </span>
                    </div>
                    <CommandBindingFields
                      label={name}
                      binding={Object.hasOwn(active.categories.bindings, c.id) ? active.categories.bindings[c.id] : undefined}
                      onChange={(next) => void useCategoryBinding.getState().setBinding(c.id, next)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
