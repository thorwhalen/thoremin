/**
 * The sequence trainer (#263): walk a player through a list of targets and learn each
 * one, instead of one Learn press per label.
 *
 * Pick a sequence (a shipped starter, a saved one, or a list typed in), press Start, and
 * the runner (`src/enroll/sequence.ts`) takes over: a lead-in to read the list, then for
 * every target a countdown with the NEXT target already showing, a hold that is
 * captured after a settle, and a verdict from the injected check. When the list ends,
 * every hold that looked like its label is enrolled through the vocabulary store's
 * ordinary `enrol` (the same path as the Learn button, so the instrument plays what was
 * just learned); a hold the check disputed is listed with "Learn anyway" and "Redo", and
 * a hold nothing was seen in is skipped. The guide, when the instrument has one, draws
 * the current target's shape large and the next one small.
 *
 * The live shape is polled from the instrument's tap at human frequency, exactly as the
 * single-shape enrolment does, and pushed once per new frame object. The runner's clock
 * is `performance.now()`; nothing here touches the tick loop.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import { MIN_SAMPLES_PER_ENTRY } from '@/extensions/air/lib/vocabulary';
import { createSequenceRunner, sequenceDurationMs, sequenceOf, sequenceLength, type FeatureVector, type SequenceRunner, type SequenceState, type TargetCheck, type TargetResult } from '@/enroll';
import { emitGuidance, emitGuidanceStop } from '@/app/enroll/guidance';
import { useControls } from '@/app/store';

/** The hush claim's owner id prefix: while a sequence runs, the instrument is quiet (the
 *  same claim the Trainer and the Conductor make, #264), so the countdown is not played
 *  over. One id per mounted trainer, so the guitar's cannot release the flute's. */
export const SEQUENCE_HUSH_ID = 'sequence-trainer';
let instances = 0;
import { listSequences, parseTargets, removeSequence, saveSequence, type NamedSequence } from '@/app/enroll/sequenceStore';
import type { VocabularyState } from '@/extensions/air/app/vocabularyStore';

/** How often the live shape is polled and the runner's clock advanced, ms. */
const POLL_MS = 30;

export interface SequenceTrainerWords {
  /** "Learn a sequence of notes". */
  title: string;
  /** "note" / "chord": the noun in the prompts. */
  noun: string;
  /** Placeholder for the typed list. */
  placeholder: string;
  /** Shown while the instrument is off. */
  offHint: string;
}

export interface SequenceTrainerProps {
  enabled: boolean;
  useVocabulary: UseBoundStore<StoreApi<VocabularyState>>;
  /** The instrument node's live shape (polled during a hold). */
  readShape: () => FeatureVector | null;
  /** The canonical label for what was typed, or null when it is not a valid label. */
  canonical: (typed: string) => string | null;
  /** Builds the per-hold check when a run starts (the model may have changed since). */
  makeCheck?: () => TargetCheck | undefined;
  /** The guide for a label, or null when there is none to draw. */
  guide?: (label: string, dim: boolean) => ReactNode;
  starters: readonly NamedSequence[];
  words: SequenceTrainerWords;
  /** The DOM id a training route scrolls to (`../training.ts`). */
  id?: string;
}

type Outcome = { label: string; result: TargetResult; learned: boolean };

/** What a result reads as in the list. */
function describe(r: TargetResult): string {
  if (r.outcome === 'skipped') return 'skipped';
  if (r.outcome === 'empty' || r.samples.length < MIN_SAMPLES_PER_ENTRY) return 'nothing seen';
  if (r.verdict?.kind === 'mismatch') return `looked like ${r.verdict.read}`;
  return 'held';
}

const learnable = (r: TargetResult) => r.outcome === 'held' && r.samples.length >= MIN_SAMPLES_PER_ENTRY && r.verdict?.kind !== 'mismatch';

export function SequenceTrainer({ enabled, useVocabulary, readShape, canonical, makeCheck, guide, starters, words, id }: SequenceTrainerProps) {
  const enrol = useVocabulary((s) => s.enrol);
  const saveError = useVocabulary((s) => s.error);
  const hushId = useRef(`${SEQUENCE_HUSH_ID}-${++instances}`).current;
  const [sequences, setSequences] = useState<NamedSequence[]>([...starters]);
  const [chosenId, setChosenId] = useState<string>(starters[0]?.id ?? '');
  const [custom, setCustom] = useState('');
  const [saveName, setSaveName] = useState('');
  const [view, setView] = useState<SequenceState | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runner = useRef<SequenceRunner | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    void listSequences(starters).then(setSequences).catch(() => setSequences([...starters]));
  }, [starters]);
  useEffect(refresh, [refresh]);

  const stopPolling = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    useControls.getState().setHush(hushId, false);
  };
  // Unmounted mid-run (the editor closed, the instrument switched): end the run as Stop
  // would, so what was held is enrolled rather than lost, and nothing keeps polling.
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => () => stopRef.current(), []);

  // The list to run: the typed one when there is text, else the chosen sequence.
  const typed = useMemo(() => parseTargets(custom), [custom]);
  const invalid = useMemo(() => typed.filter((t) => canonical(t) === null), [typed, canonical]);
  const chosen = sequences.find((s) => s.id === chosenId) ?? sequences[0] ?? null;
  const spec = useMemo(() => {
    if (typed.length > 0) return invalid.length === 0 ? sequenceOf(typed.map((t) => canonical(t)!)) : null;
    return chosen?.spec ?? null;
  }, [typed, invalid, chosen, canonical]);

  const running = view !== null && (view.phase === 'lead-in' || view.phase === 'countdown' || view.phase === 'hold');

  const finish = (r: SequenceRunner) => {
    stopPolling();
    const results = r.state().results;
    const learned: Outcome[] = [];
    for (const res of results) {
      const ok = learnable(res);
      if (ok) void enrol(res.label, res.samples);
      learned.push({ label: res.label, result: res, learned: ok });
    }
    setOutcomes(learned);
  };

  const start = () => {
    if (!spec || !enabled) return;
    setError(null);
    setOutcomes(null);
    const r = createSequenceRunner({ spec, check: makeCheck?.() });
    runner.current = r;
    r.subscribe((e) => {
      // The same channel the trainer's cues speak through: text here, and a voice clip
      // when the manifest has one for the line (a missing clip is skipped, not an error).
      if (e.type === 'target-start' || e.type === 'hold-start') emitGuidance({ t: e.t, kind: 'instruction', say: e.say });
      else if (e.type === 'target-end' && e.say) emitGuidance({ t: e.t, kind: 'guidance', say: e.say });
      else if (e.type === 'done') emitGuidance({ t: e.t, kind: 'done', say: e.say });
      else if (e.type === 'stopped') emitGuidanceStop();
      if (e.type === 'done') finish(r);
    });
    stopPolling();
    useControls.getState().setHush(hushId, true);
    r.start(performance.now());
    setView(r.state());
    let last: FeatureVector | null = null;
    timer.current = setInterval(() => {
      const now = performance.now();
      const v = readShape();
      if (v && v !== last) r.push(v, now);
      else r.tick(now);
      last = v;
      setView(r.state());
    }, POLL_MS);
  };

  const stop = () => {
    const r = runner.current;
    if (!r) return;
    const s = r.state();
    if (s.phase === 'done' || s.phase === 'stopped' || s.phase === 'idle') return;
    r.stop(performance.now());
    stopPolling();
    setView(r.state());
    if (r.state().results.length > 0) finish(r);
  };
  stopRef.current = stop;

  const learnAnyway = (o: Outcome) => {
    void enrol(o.label, o.result.samples);
    setOutcomes((prev) => prev?.map((x) => (x === o ? { ...x, learned: true } : x)) ?? null);
  };

  const save = async () => {
    if (!spec || !saveName.trim()) return;
    try {
      await saveSequence(saveName.trim(), spec);
      setSaveName('');
      refresh();
    } catch (e) {
      setError(`Could not save (${e instanceof Error ? e.message : 'storage failed'}).`);
    }
  };

  const current = view?.current ?? null;
  const next = view?.next ?? null;
  const total = spec ? sequenceLength(spec) : 0;

  return (
    <div id={id} className="space-y-2 rounded-lg border border-white/10 p-2" data-testid="sequence-trainer" data-phase={view?.phase ?? 'idle'}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">{words.title}</div>
      {!running && (
        <>
          <div className="flex gap-1">
            <select
              className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-xs"
              aria-label="Sequence"
              value={chosen?.id ?? ''}
              disabled={typed.length > 0}
              onChange={(e) => setChosenId(e.target.value)}
            >
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.starter ? '' : ' (saved)'}
                </option>
              ))}
            </select>
            {chosen && !chosen.starter && (
              <button
                className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/20"
                onClick={() => void removeSequence(chosen.id).then(refresh)}
                aria-label={`Forget ${chosen.name}`}
              >
                Forget
              </button>
            )}
          </div>
          <input
            className="w-full rounded bg-white/10 px-2 py-1 text-xs outline-none placeholder:text-white/30 focus:bg-white/20"
            placeholder={words.placeholder}
            aria-label={`Or type the ${words.noun}s`}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          {invalid.length > 0 && <p className="text-[10px] text-amber-300">Not a {words.noun}: {invalid.join(', ')}</p>}
          {spec && (
            <p className="text-[10px] text-white/50" data-testid="sequence-preview">
              {spec.targets.map((t) => t.label).join(' ')}
              {spec.loops > 1 ? ` (x${spec.loops})` : ''} — {total} {words.noun}
              {total === 1 ? '' : 's'}, about {Math.round(sequenceDurationMs(spec) / 1000)} s
            </p>
          )}
          <div className="flex items-center gap-1">
            <button
              className="rounded bg-emerald-500 px-2 py-1 text-xs font-semibold text-black transition hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/40"
              disabled={!spec || !enabled}
              onClick={start}
            >
              Start
            </button>
            {typed.length > 0 && invalid.length === 0 && (
              <>
                <input
                  className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-xs outline-none placeholder:text-white/30"
                  placeholder="Save as…"
                  aria-label="Name to save the sequence under"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
                <button className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-40" disabled={!saveName.trim()} onClick={() => void save()}>
                  Save
                </button>
              </>
            )}
          </div>
          {!enabled && <p className="text-[10px] text-white/50">{words.offHint}</p>}
        </>
      )}
      {running && view && (
        <div className="space-y-2" role="status" aria-live="polite">
          {view.phase === 'lead-in' && (
            <p className="text-sm font-semibold text-amber-200">
              Get ready… {view.countdown}. First: <span className="font-mono">{next?.label}</span>
            </p>
          )}
          {view.phase === 'countdown' && current && (
            <p className="text-sm font-semibold text-amber-200">
              Next: <span className="font-mono text-lg">{current.label}</span> in {view.countdown}
            </p>
          )}
          {view.phase === 'hold' && current && (
            <p className="text-sm font-semibold text-emerald-300">
              Hold <span className="font-mono text-lg">{current.label}</span>… {view.countdown}
              <span className="ml-2 text-[10px] text-white/50">({view.samples} frames)</span>
            </p>
          )}
          {view.phase !== 'lead-in' && (
            <p className="text-[10px] text-white/50" data-testid="sequence-next">
              {next ? (
                <>
                  Then: <span className="font-mono">{next.label}</span>
                </>
              ) : (
                'Last one.'
              )}
            </p>
          )}
          {guide && (current || next) && (
            <div className="flex items-end gap-3">
              {current && guide(current.label, false)}
              {next && guide(next.label, true)}
            </div>
          )}
          <div className="h-1 w-full overflow-hidden rounded bg-white/10" aria-hidden>
            <div className="h-full bg-emerald-400/70" style={{ width: `${Math.round(view.progress * 100)}%` }} />
          </div>
          <div className="flex gap-1">
            <button className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/20" onClick={() => runner.current?.skip(performance.now())}>
              Skip
            </button>
            <button className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/20" onClick={() => runner.current?.redo(performance.now())}>
              Redo
            </button>
            <button className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/20" onClick={stop}>
              Stop
            </button>
          </div>
        </div>
      )}
      {outcomes && (
        <ul className="space-y-0.5 text-xs" data-testid="sequence-outcomes">
          {outcomes.map((o, i) => (
            <li key={`${o.result.loop}-${o.result.index}-${i}`} className="flex items-center justify-between gap-2">
              <span>
                <span className="font-mono text-emerald-300">{o.label}</span>
                <span className={`ml-2 text-[10px] ${o.learned ? 'text-white/50' : 'text-amber-300'}`}>{o.learned ? 'learned' : describe(o.result)}</span>
              </span>
              {!o.learned && o.result.samples.length >= MIN_SAMPLES_PER_ENTRY && (
                <button className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/20" onClick={() => learnAnyway(o)}>
                  Learn anyway
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
      {saveError && <p className="text-[10px] text-rose-300">{saveError}</p>}
    </div>
  );
}
