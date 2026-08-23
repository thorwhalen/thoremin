/**
 * TrainerPanel — the shell surface for trainer mode (#160, reworked for #163), opened
 * from the tools bar.
 *
 * A TOOL, not a settings section: a trained model is a per-player, per-device artefact
 * like a keymap, not an instrument parameter, and it must never ride an instrument
 * preset. (Same reasoning as the Feature Lab and the gesture bindings.)
 *
 * ## Cues, a runner, and a conversation
 *
 * The panel renders whatever routine the store loaded — a list of cues, which are
 * data, editable through the {@link RoutinePicker} — and, while the runner runs, shows
 * what the runner SAYS: the cue's instruction, large; the latest guidance ("a bit
 * further, if you can"), beneath it; and a short transcript. The same strings are
 * painted ON THE VIDEO by the overlay's `trainerHud` element (the player is looking at
 * the camera, not at this panel); the panel is the full record, the HUD is the glance. The runner steps when it has ENOUGH, not when time passes: the coverage
 * meter is the cue's own minimum, and a cue the player cannot produce ends in
 * `cannot` and moves on rather than trapping them.
 *
 * Written guidance is always shown and is dynamic; spoken guidance (#163 §4) is a
 * toggle layered on the SAME strings. A player with sound off loses nothing.
 *
 * **Never show a face to imitate.** Every prompt is a movement the player interprets
 * or a choice that is theirs. Prescribed categories are precisely what the player
 * reported being unable to hit; a trainer that asked them to copy a target would
 * reproduce the original bug with extra steps.
 *
 * ## Sampling
 *
 * While the runner runs, the panel polls {@link readLiveVector} on an interval and
 * feeds the store — a sample when a vector is there, a bare tick when not (so patience
 * elapses and the runner can say "I could not see you"). Polling, not a subscription,
 * because the vector updates per tick and no part of this UI needs frame-rate
 * fidelity; see `enroll/liveVector.ts`. The tap's clock and `performance.now()` are the
 * same clock (`useEngine` ticks with `performance.now()/1000`), so falling back to it
 * before the first tick is safe.
 *
 * ## What this panel deliberately cannot do
 *
 * It does not change what you hear. Training produces a model and nothing else;
 * binding a category to a dial or a command is a later, separate decision and will go
 * through the #127 write path. A bad training run cannot break the instrument.
 */
import { useEffect, useRef } from 'react';
import { GraduationCap, X } from 'lucide-react';
import { categoryKey, type Category } from '@/enroll';
import { readLiveVector } from './enroll/liveVector';
import { useTrainer } from './enroll/store';
import RoutinePicker from './enroll/RoutinePicker';
import { useTools } from './toolsStore';
import { useControls } from './store';
import { useTrainerPrefs } from './enroll/prefs';
import { toolById } from './tools';

const TOOL_ID = 'trainer';
/** ~30 Hz: fast enough that the sampler's dwell logic sees a smooth signal, slow enough
 *  that the panel is not doing frame-rate work. */
const SAMPLE_INTERVAL_MS = 33;

/** Now, on the engine's clock (ms): the tap's stamp, or the same wall clock before the
 *  first tick. */
const nowMs = (): number => readLiveVector()?.t ?? performance.now();

/** The coverage meter — the Face ID ring, flattened. */
function Coverage({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-400' : 'bg-emerald-400/50'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** A category's starting name: the cue that fed most of it, when one clearly did. */
function suggestedLabel(c: Category, cueNames: Map<string, string>): string {
  if (!c.cues) return '';
  const entries = Object.entries(c.cues).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '';
  const [cueId, n] = entries[0];
  return n / c.size >= 0.7 ? cueNames.get(cueId) ?? cueId : '';
}

const OUTCOME_GLYPH = { enough: '✓', cannot: '✗', skipped: '–' } as const;

export default function TrainerPanel() {
  const open = useTools((s) => s.open) === TOOL_ID;
  const close = useTools((s) => s.close);

  const routine = useTrainer((s) => s.routine);
  const routineName = useTrainer((s) => s.routineName);
  const missing = useTrainer((s) => s.missing);
  const status = useTrainer((s) => s.status);
  const index = useTrainer((s) => s.index);
  const samples = useTrainer((s) => s.samples);
  const coverage = useTrainer((s) => s.coverage);
  const say = useTrainer((s) => s.say);
  const outcomes = useTrainer((s) => s.outcomes);
  const transcript = useTrainer((s) => s.transcript);
  const built = useTrainer((s) => s.built);
  const k = useTrainer((s) => s.k);
  const suggestedK = useTrainer((s) => s.suggestedK);
  const model = useTrainer((s) => s.model);
  const labels = useTrainer((s) => s.labels);
  const lastEndSay = useTrainer((s) => s.lastEndSay);
  const hudShow = useControls((s) => s.trainerHud.show);
  const setTrainerHud = useControls((s) => s.setTrainerHud);
  const recordTake = useTrainerPrefs((s) => s.recordTake);
  const setRecordTake = useTrainerPrefs((s) => s.setRecordTake);
  const recording = useTrainer((s) => s.recording);

  const running = status === 'running' || status === 'between';

  // Read the cue + routine stores once the panel is first opened.
  useEffect(() => {
    if (open) void useTrainer.getState().load();
  }, [open]);

  // Poll the live vector into the runner while it runs. The interval is recreated only
  // when `running` flips, so it is not restarted every render.
  const runningRef = useRef(running);
  runningRef.current = running;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (!runningRef.current) return;
      const live = readLiveVector();
      if (live) useTrainer.getState().sample(live.vector, live.t);
      else useTrainer.getState().tick(performance.now());
    }, SAMPLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running]);

  // Closing the panel (the X, or switching tools) must stop a running routine: otherwise
  // the poll keeps sampling and the feature-demand claim (#163) keeps the catalog
  // computing every tick, with nothing on screen to say so.
  useEffect(() => {
    if (!open && running) useTrainer.getState().stop(nowMs());
  }, [open, running]);

  if (!open) return null;
  const tool = toolById(TOOL_ID);
  const activeCue = index >= 0 ? routine[index] : null;
  // The instruction stays up for the whole cue; a variation ("a bit further") is the
  // runner's LAST utterance and goes beneath it, never in its place.
  const guidance = status === 'running' && activeCue && say && say !== activeCue.instruction ? say : null;
  // Buildable only with something to carve: a routine that ended with every vocabulary
  // cue skipped or `cannot` is "done" and still has no still-points.
  const canBuild = (status === 'done' || status === 'stopped') && useTrainer.getState().session().ready();
  const cueNames = new Map(routine.map((c) => [c.id, c.name]));
  const latestEnd = [...transcript].reverse().find((l) => l.kind === 'end' && l.outcome === 'cannot');

  // While a routine runs the panel collapses to a slim strip: the instruction is on
  // the video (the HUD), and a full-height panel would sit over it. Skip / Stop and
  // the meter stay within reach; the full panel returns when the routine ends.
  if (running && activeCue) {
    return (
      <div
        data-tool={TOOL_ID}
        data-compact
        className="absolute bottom-14 left-3 z-40 flex w-96 max-w-[calc(100vw-1.5rem)] flex-col gap-1 rounded-2xl border border-emerald-400/30 bg-black/70 px-3 py-2 backdrop-blur"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <GraduationCap className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
          {recording && (
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-red-400" title="This take is being recorded (camera, features, annotations)">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden /> rec
            </span>
          )}
          <span className="flex-1 truncate text-[11px] text-white/85">
            <span className="text-white/40">
              {index + 1}/{routine.length} ·{' '}
            </span>
            {activeCue.name}
            {status === 'between' && <span className="text-white/40"> · next</span>}
          </span>
          <span className="text-[10px] tabular-nums text-white/40">
            {samples} {activeCue.produces === 'vocabulary' ? 'held' : 'frames'}
          </span>
          <button
            onClick={() => useTrainer.getState().skip(nowMs())}
            className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80 transition hover:bg-white/20"
          >
            Skip
          </button>
          <button
            onClick={() => useTrainer.getState().stop(nowMs())}
            className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80 transition hover:bg-white/20"
          >
            Stop
          </button>
        </div>
        {/* The written channel is ALWAYS here too, in case the HUD is hidden. */}
        <p className="truncate text-[11px] text-white" data-say title={activeCue.instruction}>
          {status === 'between' ? lastEndSay ?? '' : activeCue.instruction}
        </p>
        {guidance && <p className="truncate text-[10px] italic text-emerald-200/80" data-guidance>{guidance}</p>}
        <Coverage value={coverage} />
      </div>
    );
  }

  return (
    <div
      data-tool={TOOL_ID}
      className="absolute bottom-14 left-3 z-40 flex max-h-[calc(100dvh-5rem)] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/70 backdrop-blur"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <GraduationCap className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-white/70">Trainer</span>
        <button
          onClick={close}
          aria-label="Close the Trainer panel"
          className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 overflow-auto p-4">
        {tool && <p className="text-[10px] uppercase tracking-widest text-emerald-500/70">{tool.description}</p>}
        {status === 'idle' && (
          <p className="text-[11px] leading-relaxed text-white/60">
            Teach the instrument the positions <em>you</em> can actually hit, instead of trying to hit the
            ones it came with. It asks for one thing at a time and moves on when it has enough. About a
            minute. Nothing you do here changes the sound yet.
          </p>
        )}

        {/* The routine: one row per cue, with its outcome so far. */}
        <div className="space-y-1">
          <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-widest text-white/40">
            <span className="flex-1">Routine · {routineName}</span>
            <span className="tabular-nums">{routine.length} cues</span>
          </div>
          <ol className="space-y-0.5" aria-label="Routine">
            {routine.map((cue, i) => {
              const active = running && i === index;
              const outcome = outcomes[i];
              return (
                <li
                  key={cue.id}
                  data-cue={cue.id}
                  data-active={active || undefined}
                  className={`flex items-center gap-2 rounded px-2 py-0.5 text-[11px] ${active ? 'bg-emerald-500/15 text-white' : 'text-white/60'}`}
                  title={cue.rationale || cue.instruction}
                >
                  <span className="w-3 text-center text-[10px] tabular-nums text-white/35" aria-hidden>
                    {outcome ? OUTCOME_GLYPH[outcome] : active ? '●' : i + 1}
                  </span>
                  <span className="flex-1 truncate">{cue.name}</span>
                  {outcome && (
                    <span className="text-[10px] text-white/35">
                      {outcome === 'enough' ? 'done' : outcome === 'cannot' ? 'could not' : 'skipped'}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {missing.length > 0 && (
            <p className="text-[10px] text-amber-300/80">Skipping {missing.length} cue(s) this routine names that no longer exist.</p>
          )}
          {/* The picker (#163 §3): filter, include, reorder, save. Not while running. */}
          {!running && <RoutinePicker />}
        </div>

        <button
          onClick={() => void useTrainer.getState().startTake(nowMs)}
          disabled={routine.length === 0}
          className="w-full rounded-lg bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white/90 transition hover:bg-white/20 disabled:opacity-30"
        >
          {status === 'idle' ? 'Start' : 'Run again'}
        </button>
        {/* Per-device prefs (not instrument parameters): the guidance on the video, and
            whether the take is recorded. */}
        <label className="flex items-center gap-2 text-[10px] text-white/60">
          <input type="checkbox" checked={hudShow} onChange={(e) => setTrainerHud({ show: e.target.checked })} />
          Show the instructions on the video while it runs
        </label>
        <label className="flex items-center gap-2 text-[10px] text-white/60" title="Saves the clean camera video, the feature vectors and the cue/verdict annotations as a recording (like the Record button does).">
          <input type="checkbox" checked={recordTake} onChange={(e) => setRecordTake(e.target.checked)} />
          Record the take (camera + features + annotations)
        </label>

        {status === 'done' && (
          <p className="text-[11px] text-emerald-200/80">That is everything. Now find your categories.</p>
        )}
        {latestEnd && status !== 'idle' && (
          <p className="text-[10px] text-white/40">{latestEnd.why}</p>
        )}

        {transcript.length > 0 && (
          <details className="text-[10px] text-white/40">
            <summary className="cursor-pointer select-none">What it said</summary>
            <ul className="mt-1 space-y-0.5" aria-label="Transcript">
              {transcript.slice(-12).map((l, i) => (
                <li key={i} className={l.kind === 'guidance' ? 'italic text-emerald-200/60' : ''}>
                  {/* A `cannot` reads reason first, then the runner's "Moving on." */}
                  {l.kind === 'end' && l.outcome === 'cannot' && l.why ? `${l.why} ${l.say}` : l.say}
                </li>
              ))}
            </ul>
          </details>
        )}

        <button
          onClick={() => useTrainer.getState().build()}
          disabled={!canBuild}
          className="w-full rounded-lg bg-emerald-500/80 px-3 py-1.5 text-[11px] font-bold text-black transition hover:bg-emerald-400 disabled:opacity-30"
        >
          {built ? 'Rebuild from this take' : 'Find my categories'}
        </button>

        {built && model && (
          <div className="space-y-2.5 border-t border-white/10 pt-3">
            <label className="block space-y-1">
              <span className="flex items-baseline gap-2 text-[11px] text-white/80">
                <span className="flex-1">How many categories?</span>
                <span className="tabular-nums text-white/50">{k}</span>
              </span>
              <input
                type="range"
                aria-label="How many categories"
                min={2}
                max={8}
                step={1}
                value={k}
                onChange={(e) => useTrainer.getState().setK(Number(e.target.value))}
                className="w-full"
              />
              <span className="block text-[10px] leading-snug text-white/40">
                Drag freely — this re-cuts the same recording, it does not retrain, and a name you
                typed stays with its poses. Your take looks most like{' '}
                <strong className="text-white/60">{suggestedK}</strong> groups to us, but that is a
                guess and you know what you did better.
              </span>
            </label>

            <ul className="space-y-1">
              {model.categories.map((c, i) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="w-4 text-[10px] tabular-nums text-white/35">{i + 1}</span>
                  <input
                    aria-label={`Name for category ${i + 1}`}
                    placeholder={suggestedLabel(c, cueNames) || 'name this one…'}
                    value={labels[categoryKey(c)] ?? ''}
                    onChange={(e) => useTrainer.getState().setLabel(categoryKey(c), e.target.value)}
                    className="min-w-0 flex-1 rounded bg-white/5 px-2 py-1 text-[11px] text-white/85 placeholder:text-white/25"
                  />
                  <span className="text-[10px] tabular-nums text-white/35" title="how many held poses formed it">
                    {c.size}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] leading-snug text-white/40">
              Built from {model.features.length} of your most distinctive features, measured in multiples of
              their own jitter.
              {routine.some((c, i) => c.produces === 'nuisance' && outcomes[i] === 'enough') &&
                ' Anything that moved during the "should not matter" cue was quieted.'}
            </p>
          </div>
        )}

        <button
          onClick={() => useTrainer.getState().reset()}
          className="w-full rounded border border-white/10 px-3 py-1 text-[10px] text-white/50 transition hover:bg-white/5 hover:text-white/80"
        >
          Start over
        </button>
      </div>
    </div>
  );
}
