/**
 * TrainerPanel — the shell surface for trainer mode (#160), opened from the tools bar.
 *
 * A TOOL, not a settings section: a trained model is a per-player, per-device artefact
 * like a keymap, not an instrument parameter, and it must never ride an instrument
 * preset. (Same reasoning as the Feature Lab and the gesture bindings.)
 *
 * ## The four-step ritual, and the two rules its UI has to keep
 *
 * The steps come from {@link ENROLLMENT_STEPS} — they are data, so this file renders
 * whatever is in the list and gains a step when one is added.
 *
 * **A coverage meter, not a progress bar.** The transferable half of Face ID's enrollment
 * ring: it shows how much of what a step needs has actually been captured, and the step
 * is not "done" because time passed — it is done when there is enough. A progress bar
 * would tell the player the opposite thing.
 *
 * **Never show a face to imitate.** Every prompt is the player's own choice of
 * expression. Prescribed categories are precisely what the player reported being unable
 * to hit; a trainer that asked them to copy a target would reproduce the original bug
 * with extra steps.
 *
 * ## Sampling
 *
 * While a step runs, the panel polls {@link readLiveVector} on an interval and feeds the
 * session. Polling — not a subscription — because the vector updates per tick and no part
 * of this UI needs frame-rate fidelity; see `enroll/liveVector.ts` for why the tap writes
 * a module holder rather than a store.
 *
 * ## What this panel deliberately cannot do
 *
 * It does not change what you hear. Training produces a model and nothing else; binding a
 * category to a dial or a command is a later, separate decision and will go through the
 * #127 write path. A bad training run cannot break the instrument.
 */
import { useEffect, useRef } from 'react';
import { GraduationCap, X } from 'lucide-react';
import { ENROLLMENT_STEPS, stepById } from '@/enroll';
import { readLiveVector } from './enroll/liveVector';
import { useTrainer } from './enroll/store';
import { useTools } from './toolsStore';
import { toolById } from './tools';

const TOOL_ID = 'trainer';
/** ~30 Hz: fast enough that the sampler's dwell logic sees a smooth signal, slow enough
 *  that the panel is not doing frame-rate work. */
const SAMPLE_INTERVAL_MS = 33;

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

export default function TrainerPanel() {
  const open = useTools((s) => s.open) === TOOL_ID;
  const close = useTools((s) => s.close);

  const activeStep = useTrainer((s) => s.activeStep);
  const progress = useTrainer((s) => s.progress);
  const built = useTrainer((s) => s.built);
  const k = useTrainer((s) => s.k);
  const suggestedK = useTrainer((s) => s.suggestedK);
  const model = useTrainer((s) => s.model);
  const labels = useTrainer((s) => s.labels);

  // Poll the live vector into the session while a step is running. The interval is
  // recreated only when the active step changes, so it is not restarted every render.
  const activeRef = useRef(activeStep);
  activeRef.current = activeStep;
  useEffect(() => {
    if (!activeStep) return;
    const id = setInterval(() => {
      if (!activeRef.current) return;
      const live = readLiveVector();
      if (live) useTrainer.getState().sample(live.vector, live.t);
    }, SAMPLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [activeStep]);

  if (!open) return null;
  const tool = toolById(TOOL_ID);
  const progressFor = (id: string) => progress.find((p) => p.id === id);
  const vocabSamples = progressFor('vocabulary')?.samples ?? 0;
  const canBuild = vocabSamples >= (stepById('vocabulary')?.minSamples ?? 6);

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
        <p className="text-[11px] leading-relaxed text-white/60">
          Teach the instrument the faces <em>you</em> can actually make, instead of trying to hit the
          ones it came with. Takes about a minute. Nothing you do here changes the sound yet.
        </p>

        {ENROLLMENT_STEPS.map((step) => {
          const p = progressFor(step.id);
          const running = activeStep === step.id;
          const done = (p?.coverage ?? 0) >= 1;
          return (
            <div key={step.id} className="space-y-1.5 rounded-lg border border-white/10 p-2.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[11px] font-semibold text-white/85">
                  {step.title}
                  {done && <span className="ml-1.5 text-emerald-400">✓</span>}
                </span>
                <span className="text-[10px] tabular-nums text-white/40">{p?.samples ?? 0}</span>
                <button
                  onClick={() => (running ? useTrainer.getState().end() : useTrainer.getState().begin(step.id))}
                  disabled={activeStep !== null && !running}
                  className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80 transition hover:bg-white/20 disabled:opacity-30"
                >
                  {running ? 'Stop' : done ? 'Redo' : 'Start'}
                </button>
              </div>
              <p className="text-[11px] leading-snug text-white/70">{step.prompt}</p>
              <p className="text-[10px] leading-snug text-white/40">{step.rationale}</p>
              <Coverage value={p?.coverage ?? 0} />
            </div>
          );
        })}

        <button
          onClick={() => useTrainer.getState().build()}
          disabled={!canBuild || activeStep !== null}
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
                Drag freely — this re-cuts the same recording, it does not retrain. Your take
                looks most like <strong className="text-white/60">{suggestedK}</strong> groups to us,
                but that is a guess and you know your own faces better.
              </span>
            </label>

            <ul className="space-y-1">
              {model.categories.map((c, i) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="w-4 text-[10px] tabular-nums text-white/35">{i + 1}</span>
                  <input
                    aria-label={`Name for category ${i + 1}`}
                    placeholder="name this face…"
                    value={labels[c.id] ?? ''}
                    onChange={(e) => useTrainer.getState().setLabel(c.id, e.target.value)}
                    className="min-w-0 flex-1 rounded bg-white/5 px-2 py-1 text-[11px] text-white/85 placeholder:text-white/25"
                  />
                  <span className="text-[10px] tabular-nums text-white/35" title="how many held poses formed it">
                    {c.size}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] leading-snug text-white/40">
              Built from {model.features.length} of your most distinctive features. Anything that
              moved while you changed camera distance was quieted automatically.
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
