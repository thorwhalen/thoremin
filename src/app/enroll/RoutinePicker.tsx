/**
 * RoutinePicker (#163 §3) — choose which cues a routine runs, in what order; save it.
 *
 * The cue collection grows (starters, stored overrides, custom cues) and the catalog
 * has hundreds of features, so an unfiltered list stops being usable fast: the picker
 * filters by free text (name / instruction) and by tag chips (`face`, `pose`,
 * `expression`, `setup`, …), the same approach the instrument library takes with its
 * favourites and tags.
 *
 * The draft is local React state; "Use" applies it to the trainer store, "Save as"
 * persists it to the routine collection (a zodal named collection — localStorage by
 * default). Hidden while a routine runs: the runner holds its own cue list and the
 * store refuses to swap it mid-run.
 */
import { useMemo, useState } from 'react';
import { cueTags, filterCues } from './cueStore';
import { useTrainer } from './store';

export default function RoutinePicker() {
  const cues = useTrainer((s) => s.cues);
  const routine = useTrainer((s) => s.routine);
  const routineName = useTrainer((s) => s.routineName);
  const savedRoutines = useTrainer((s) => s.savedRoutines);
  const unusable = useTrainer((s) => s.unusable);

  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saveName, setSaveName] = useState('');

  const ids = draft ?? routine.map((c) => c.id);
  const allTags = useMemo(() => cueTags(cues), [cues]);
  const visible = useMemo(() => filterCues(cues, query, tags), [cues, query, tags]);
  const byId = useMemo(() => new Map(cues.map((c) => [c.id, c])), [cues]);

  const toggle = (id: string) => setDraft(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  /** The included cues the filter currently shows, in routine order. */
  const visibleIncluded = ids.filter((id) => visible.some((c) => c.id === id));
  /** Swap with the nearest VISIBLE included neighbour: with a filter on, a move must
   *  change what the player sees, never a hidden row behind it. */
  const move = (id: string, dir: -1 | 1) => {
    const vi = visibleIncluded.indexOf(id);
    const other = visibleIncluded[vi + dir];
    if (vi < 0 || !other) return;
    const i = ids.indexOf(id);
    const j = ids.indexOf(other);
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };
  const [selectedSaved, setSelectedSaved] = useState('');
  const dirty = draft !== null && draft.join(',') !== routine.map((c) => c.id).join(',');

  return (
    <details className="rounded-lg border border-white/10 p-2 text-[11px]" data-routine-picker>
      <summary className="cursor-pointer select-none text-white/60">
        Edit routine <span className="text-white/35">· {ids.length} cues{dirty ? ' (unsaved)' : ''}</span>
      </summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-1">
          <input
            aria-label="Filter cues"
            placeholder="filter cues…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 rounded bg-white/5 px-2 py-1 text-[11px] text-white/85 placeholder:text-white/25"
          />
          {allTags.map((t) => {
            const on = tags.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
                className={`rounded-full px-2 py-0.5 text-[10px] ${on ? 'bg-emerald-500/40 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* The draft routine, in order, then the rest of the (filtered) cues. */}
        <ol className="space-y-0.5" aria-label="Cues">
          {[...ids.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c && visible.includes(c)), ...visible.filter((c) => !ids.includes(c.id))].map((cue) => {
            const included = ids.includes(cue.id);
            return (
              <li key={cue.id} className="flex items-center gap-2" data-picker-cue={cue.id}>
                <input
                  type="checkbox"
                  aria-label={`Include ${cue.name}`}
                  checked={included}
                  onChange={() => toggle(cue.id)}
                />
                <span className={`flex-1 truncate ${included ? 'text-white/85' : 'text-white/50'}`} title={cue.instruction}>
                  {cue.name} <span className="text-white/30">· {cue.instruction}</span>
                </span>
                {included && (
                  <span className="flex gap-0.5">
                    <button type="button" aria-label={`Move ${cue.name} up`} onClick={() => move(cue.id, -1)} className="rounded px-1 text-white/40 hover:bg-white/10 hover:text-white">↑</button>
                    <button type="button" aria-label={`Move ${cue.name} down`} onClick={() => move(cue.id, 1)} className="rounded px-1 text-white/40 hover:bg-white/10 hover:text-white">↓</button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {visible.length === 0 && <p className="text-white/35">No cue matches.</p>}
        {unusable.length > 0 && (
          <p className="text-[10px] text-amber-300/80">{unusable.length} stored cue(s) name no feature this build knows and were left out.</p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={!dirty || ids.length === 0}
            onClick={() => {
              useTrainer.getState().setRoutine(ids, 'Custom');
              setDraft(null);
            }}
            className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80 hover:bg-white/20 disabled:opacity-30"
          >
            Use
          </button>
          <input
            aria-label="Routine name"
            placeholder="save as…"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            className="w-28 rounded bg-white/5 px-2 py-0.5 text-[10px] text-white/85 placeholder:text-white/25"
          />
          <button
            type="button"
            disabled={saveName.trim() === '' || ids.length === 0}
            onClick={() => {
              void useTrainer.getState().saveRoutine(saveName.trim(), ids);
              setDraft(null);
              setSaveName('');
            }}
            className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80 hover:bg-white/20 disabled:opacity-30"
          >
            Save
          </button>
          <select
            aria-label="Saved routines"
            value={selectedSaved}
            onChange={(e) => {
              const id = e.target.value;
              setSelectedSaved(id);
              if (id === '__default') void useTrainer.getState().useRoutine(null);
              else if (id) void useTrainer.getState().useRoutine(id);
              setDraft(null);
            }}
            className="rounded bg-white/5 px-1 py-0.5 text-[10px] text-white/70"
          >
            <option value="">load… ({routineName})</option>
            <option value="__default">Default</option>
            {savedRoutines.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {selectedSaved && selectedSaved !== '__default' && (
            <button
              type="button"
              aria-label="Delete the selected saved routine"
              onClick={() => {
                void useTrainer.getState().removeRoutine(selectedSaved);
                setSelectedSaved('');
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-rose-300/80 hover:bg-rose-500/20"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
