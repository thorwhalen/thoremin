/**
 * The open categorizer's live half (#330 P3): try it (a live readout: which category, the
 * memberships, "none of these"), correct it ("this face is X", or record more faces and merge
 * them in), tune it (sensitivity, reject radius, distance; at classification time, no
 * retraining), and carry it as a file (export; import is beside the saved list).
 *
 * #385 E7 adds the checks: the **quiz** (each category asked twice in a random order: found in
 * time, slowly, or missed; kept with the categorizer, a miss offering "Record more" with the
 * burst named for it) and the **everyday check** (a minute of doing nothing in particular,
 * counting accidental fires); and one **size** dial per category.
 *
 * Rendering only: the actions are the session store's (`../app/sessionStore.ts`) and the test
 * store's (`../app/testStore.ts`); what a tuning means is `../lib/live.ts`.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { FaceSessionState, MergeSeed } from '../app/sessionStore';
import type { FaceTestState } from '../app/testStore';
import { NEUTRAL_TARGET } from '@thoremin/sdk/enroll/quality';
import { QUIZ_DEFAULTS, summarizeQuiz, type QuizTrial } from '@thoremin/sdk/enroll/quiz';
import { everydayFlags, everydayResult } from '@thoremin/sdk/enroll/everyday';
import { liveModel, TUNING_BOUNDS, type LiveModel, type LiveReading, type Tuning } from '../lib/live';

const btn = 'rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/90 transition hover:bg-white/20 disabled:opacity-40';
const primary = 'rounded-md border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-40';
const hint = 'text-[11px] leading-relaxed text-white/60';
const heading = 'text-[10px] font-bold uppercase tracking-widest text-white/50';

/** What each merge seed does, in the player's words. */
export const MERGE_TEXT: Record<MergeSeed, { button: string; says: string }> = {
  samples: {
    button: 'Add more of my faces',
    says: 'Record a short take; each new face joins its nearest category and the categories move toward it. Everything already here stays.',
  },
  centroids: {
    button: 'Retrain on my face',
    says: 'For a categorizer made by someone else: keeps only which category is which, and learns every category again from your take.',
  },
};

/**
 * The margin meter (#385 E6, design C.3.3): how deep inside its nearest category (or Neutral) this
 * frame is, from the distance to it against the runner-up's and against the reject radius
 * (whichever is nearer): full on the centre, empty on the boundary. The live form of Sorting's quality chip: a face that only ever reaches "on the edge"
 * is one to make bigger, or to merge.
 */
function MarginMeter({ r, live }: { r: LiveReading; live: LiveModel }) {
  const m = r.margin;
  if (m.nearest === null) return null;
  const name = (id: string | null): string => (id === NEUTRAL_TARGET ? 'Neutral' : live.model.categories.find((c) => c.id === id)?.label || id || '');
  const says =
    m.state === 'outside'
      ? 'outside every category'
      : m.state === 'edge'
        ? m.edgeOf === 'radius'
          ? `at the outer edge of ${name(m.nearest)}`
          : `on the edge with ${name(m.second)}`
        : `safely inside ${name(m.nearest)}`;
  const colour = m.state === 'inside' ? 'bg-emerald-400' : m.state === 'edge' ? 'bg-amber-400' : 'bg-white/25';
  return (
    <div className="flex items-center gap-2 text-[10px]" data-faces-margin={m.state}>
      <span className="w-24 shrink-0 text-white/60">margin</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded bg-white/10" title={`Distance to ${name(m.nearest)}: ${m.d1.toFixed(1)}; to ${m.second ? name(m.second) : 'nothing else'}: ${Number.isFinite(m.d2) ? m.d2.toFixed(1) : '-'}`}>
        <span className={`block h-full ${colour}`} style={{ width: `${Math.round(Math.min(1, m.depth) * 100)}%` }} />
      </span>
      <span className="w-32 shrink-0 truncate text-right text-white/60">{says}</span>
    </div>
  );
}

function Readout({ test, live }: { test: FaceTestState; live: LiveModel }) {
  const r = test.reading;
  const none = r !== null && (r.rejected || r.neutral);
  const headline = test.noFace ? 'No face in view' : !r ? 'Reading...' : r.label ? r.label : none ? 'None of these' : 'Settling...';
  const taught = (live.model.neutral?.length ?? 0) > 0;
  return (
    <div className="space-y-1.5" data-faces-readout>
      <p className="text-base font-bold text-white" role="status" aria-live="polite" data-faces-reading={r?.categoryId ?? (none ? 'none' : '')}>
        {headline}
      </p>
      {r && !test.noFace && <MarginMeter r={r} live={live} />}
      <ul className="space-y-0.5">
        {live.model.categories.map((c) => {
          const m = r?.memberships.find((x) => x.id === c.id)?.value ?? 0;
          const on = r?.categoryId === c.id;
          return (
            <li key={c.id} className="flex items-center gap-2 text-[10px]">
              <span className={`w-24 shrink-0 truncate ${on ? 'font-semibold text-emerald-200' : 'text-white/60'}`}>{c.label || c.id}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded bg-white/10">
                <span className={`block h-full ${none ? 'bg-white/25' : on ? 'bg-emerald-400' : 'bg-white/50'}`} style={{ width: `${Math.round(m * 100)}%` }} />
              </span>
              <span className="w-8 shrink-0 text-right text-white/40">{Math.round(m * 100)}%</span>
            </li>
          );
        })}
        {taught && (
          <li className="flex items-center gap-2 text-[10px]" data-faces-neutral-bar>
            <span className={`w-24 shrink-0 truncate ${r?.neutral ? 'font-semibold text-sky-200' : 'text-white/60'}`}>Neutral</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded bg-white/10">
              <span className={`block h-full ${r?.neutral ? 'bg-sky-400' : 'bg-white/30'}`} style={{ width: `${Math.round((r?.neutralMembership ?? 0) * 100)}%` }} />
            </span>
            <span className="w-8 shrink-0 text-right text-white/40">{Math.round((r?.neutralMembership ?? 0) * 100)}%</span>
          </li>
        )}
      </ul>
      {r && (
        <p className="text-[10px] text-white/40">
          {r.radius === null
            ? `Distance to the nearest category: ${r.distance.toFixed(1)}. A face you never taught reads as its nearest face${taught ? ', or none of these when it is nearer your Neutral faces' : ''}.`
            : `Distance to the nearest category: ${r.distance.toFixed(1)}; beyond ${r.radius.toFixed(1)} a face is none of these${taught ? ', as is one nearer your Neutral faces' : ''}.`}
        </p>
      )}
    </div>
  );
}

type DialKey = Exclude<keyof Tuning, 'sizes'> | 'size';

function Dial({ label, value, k, disabled, says, onChange }: { key?: string; label: string; value: number; k: DialKey; disabled?: boolean; says: string; onChange: (v: number) => void }) {
  const b = TUNING_BOUNDS[k];
  return (
    <div className="space-y-0.5">
      <label className="flex items-center gap-2 text-[11px] text-white/80">
        <span className="w-28 shrink-0">
          {label}: {k === 'distance' ? `${Math.round(value * 100)}%` : `x${value.toFixed(2)}`}
        </span>
        <input
          type="range"
          aria-label={label}
          min={b.min}
          max={b.max}
          step={0.05}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 disabled:opacity-40"
        />
      </label>
      {says && <p className="text-[10px] leading-snug text-white/45">{says}</p>}
    </div>
  );
}

function TuningDials({ s, live }: { s: FaceSessionState; live: LiveModel }) {
  const t = s.tuning;
  const partition = s.working?.strangers === 'nearest';
  return (
    <div className="space-y-2" data-faces-tuning>
      <h4 className={heading}>Tune (no retraining)</h4>
      <Dial
        label="Sensitivity"
        k="sensitivity"
        value={t.sensitivity}
        disabled={!live.rest}
        onChange={(v) => s.setTuning({ sensitivity: v })}
        says={
          live.rest
            ? 'Above 1, a smaller face reaches its category; below 1, it takes a bigger one. Measured from your resting face.'
            : 'This categorizer has no resting face to measure from (no neutral faces), so sensitivity does nothing.'
        }
      />
      <Dial
        label="Reject radius"
        k="rejectScale"
        value={partition ? 1 : t.rejectScale}
        disabled={partition}
        onChange={(v) => s.setTuning({ rejectScale: v })}
        says={
          partition
            ? 'A face you never taught reads as its nearest face here, so there is no radius to set (switch it to Neutral above to have one).'
            : 'How far from every category a face may be and still count. Larger: fewer faces read as none of these. At x1 it accepts at least nine in ten of your own faces.'
        }
      />
      <Dial
        label="Distance"
        k="distance"
        value={t.distance}
        disabled={!live.distance.learned}
        onChange={(v) => s.setTuning({ distance: v })}
        says={
          live.distance.learned
            ? 'Takes out what moving toward or away from the camera does to your faces, as your own take showed it.'
            : live.distance.proxy
              ? 'Your take stayed at one distance from the camera, so it shows nothing about distance to take out. Record more faces at another distance to teach it.'
              : 'This categorizer carries no camera-distance measure, so there is nothing to take out.'
        }
      />
      <div className="space-y-1.5" data-faces-sizes>
        <p className="text-[11px] text-white/80">Size of each face</p>
        <p className="text-[10px] leading-snug text-white/45">How big a face it takes to count as each one. Below 1 a smaller face reaches it (for a face you can only make small); above 1 it takes a bigger one (for a face that fires by accident). The margin meter shows where you are.</p>
        {live.model.categories.map((c) => (
          <Dial
            key={c.id}
            label={`Size of ${c.label || c.id}`}
            k="size"
            value={t.sizes[c.id] ?? 1}
            onChange={(v) => s.setTuning({ sizes: { ...t.sizes, [c.id]: v } })}
            says=""
          />
        ))}
      </div>
    </div>
  );
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/**
 * The quiz (#385 E7, design C.4.9): each category named twice in a random order, with a relax
 * between; found within 2 s and held for 1 s is found, later is slow, never is missed. The result
 * is kept with the categorizer (Save), beside each category's quality chip.
 */
function QuizBox({ session, test, live }: { session: StoreApi<FaceSessionState>; test: StoreApi<FaceTestState>; live: LiveModel }) {
  const t = useStore(test);
  const s = useStore(session);
  const q = t.quiz;
  const label = (id: string | null) => (id ? live.model.categories.find((c) => c.id === id)?.label || id : '');
  const start = () =>
    t.startQuiz(live, {
      onDone: (trials) => session.getState().setChecks({ quiz: summarizeQuiz(trials, new Map(live.model.categories.map((c) => [c.id, c.label])), new Date().toISOString()) }),
    });
  if (!q) {
    return (
      <div className="flex items-start gap-2">
        <button type="button" className={btn} onClick={start} disabled={live.model.categories.length === 0}>
          Quiz me
        </button>
        <p className="text-[10px] leading-snug text-white/45">{`Names your faces in a random order, each twice, with a rest between: make each within ${QUIZ_DEFAULTS.hitMs / 1000} s and hold it for ${QUIZ_DEFAULTS.holdMs / 1000} s. Shows which faces you can find again.`}</p>
      </div>
    );
  }
  const step = q.step;
  if (step.kind !== 'done') {
    return (
      <div className="space-y-1" data-faces-quiz={step.kind}>
        <p className="text-base font-bold text-white" role="status" aria-live="polite">
          {step.kind === 'ask' ? `Make: ${label(step.categoryId)}` : step.kind === 'relax' ? `Relax... next: ${label(step.next)}` : 'Starting...'}
        </p>
        {step.kind === 'ask' && (
          <span className="block h-1.5 overflow-hidden rounded bg-white/10" title="Held so far">
            <span className="block h-full bg-emerald-400" style={{ width: `${Math.round(Math.min(1, step.heldMs / QUIZ_DEFAULTS.holdMs) * 100)}%` }} />
          </span>
        )}
        <p className="text-[10px] text-white/50">{'index' in step ? `${step.index + 1} of ${step.total}` : ''}</p>
        <button type="button" className={btn} onClick={() => t.stopCheck()}>
          Stop the quiz
        </button>
      </div>
    );
  }
  const result = s.checks.quiz;
  const hits = q.trials.filter((x): x is QuizTrial & { vector: NonNullable<QuizTrial['vector']> } => x.outcome !== 'miss' && x.vector !== undefined);
  return (
    <div className="space-y-1.5" data-faces-quiz="done">
      <h4 className={heading}>Quiz result</h4>
      <ul className="space-y-1">
        {live.model.categories.map((c) => {
          const r = result?.categories[c.id];
          if (!r) return null;
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-[11px] text-white/80" data-faces-quiz-result={c.id}>
              <span className="w-24 shrink-0 truncate font-semibold">{c.label || c.id}</span>
              <span className={r.hits === r.asked ? 'text-emerald-300' : r.misses > 0 ? 'text-amber-300' : 'text-white/70'}>
                {`found ${r.hits} of ${r.asked} in time`}
                {r.slow ? `, ${r.slow} slowly` : ''}
                {r.misses ? `, missed ${r.misses}${r.confusedWith ? ` (read as ${label(r.confusedWith)})` : ''}` : ''}
                {r.medianTimeMs !== null ? `; typically ${seconds(r.medianTimeMs)}` : ''}
              </span>
              {r.misses + r.slow > 0 && (
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    t.stop();
                    s.setBurstName(c.label);
                    s.startMerge('samples');
                  }}
                >
                  {`Record more ${c.label || c.id}`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className={hint}>Kept with this categorizer when you save. A face you missed: record more of it (hold B with its name), make it bigger, or merge it.</p>
      <div className="flex flex-wrap gap-2">
        {hits.length > 0 && (
          <button
            type="button"
            className={btn}
            onClick={() => {
              for (const h of hits) s.correct(h.categoryId, h.vector);
              t.stopCheck();
            }}
          >
            {`Keep the ${hits.length} found faces as samples`}
          </button>
        )}
        <button type="button" className={btn} onClick={start}>
          Again
        </button>
        <button type="button" className={btn} onClick={() => t.stopCheck()}>
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * The everyday check (#385 E7): a minute of talking and looking around, counting which faces fire
 * by accident. The result is kept with the categorizer (Save).
 */
function EverydayBox({ session, test, live }: { session: StoreApi<FaceSessionState>; test: StoreApi<FaceTestState>; live: LiveModel }) {
  const t = useStore(test);
  const s = useStore(session);
  const e = t.everyday;
  const start = () =>
    t.startEveryday(live, {
      onDone: (check, at) => session.getState().setChecks({ everyday: everydayResult(check, at, new Map(live.model.categories.map((c) => [c.id, c.label])), new Date().toISOString()) }),
    });
  if (!e) {
    return (
      <div className="flex items-start gap-2">
        <button type="button" className={btn} onClick={start}>
          Everyday check
        </button>
        <p className="text-[10px] leading-snug text-white/45">Talk, look around and play normally for a minute, making none of your faces on purpose. Counts which faces fire by accident.</p>
      </div>
    );
  }
  if (!e.done) {
    const fired = Object.entries(e.fires).filter(([, n]) => n > 0);
    return (
      <div className="space-y-1" data-faces-everyday="running">
        <p className="text-sm font-semibold text-white" role="status" aria-live="polite">{`Talk, look around, play normally: ${Math.floor(e.elapsedMs / 1000)} s of ${Math.round(e.durationMs / 1000)} s`}</p>
        <p className="text-[10px] text-white/50">{fired.length === 0 ? 'Nothing has fired yet.' : `Fired so far: ${fired.map(([id, n]) => `${live.model.categories.find((c) => c.id === id)?.label || id} ${n}`).join(', ')}`}</p>
        <button type="button" className={btn} onClick={() => t.stopCheck()}>
          Stop the check
        </button>
      </div>
    );
  }
  const flags = s.checks.everyday ? everydayFlags(s.checks.everyday) : [];
  return (
    <div className="space-y-1" data-faces-everyday="done">
      <h4 className={heading}>Everyday check</h4>
      {flags.length === 0 ? (
        <p className={hint}>Nothing fired by accident often enough to worry about.</p>
      ) : (
        <ul className="space-y-0.5">
          {flags.map((f) => (
            <li key={f.categoryId} className="text-[11px] text-amber-200" data-faces-everyday-flag={f.categoryId}>
              {`"${f.label}" fired ${f.fires} ${f.fires === 1 ? 'time' : 'times'} while you did other things (${f.perMinute.toFixed(1)} a minute): make it bigger, set its size above 1, or merge it.`}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={start}>
          Again
        </button>
        <button type="button" className={btn} onClick={() => t.stopCheck()}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Try it, correct it, tune it, file it: the open categorizer's live half. */
export function TestAndTune({ session, test }: { session: StoreApi<FaceSessionState>; test: StoreApi<FaceTestState> }) {
  const s = useStore(session);
  const t = useStore(test);
  const live = useMemo(() => (s.working ? liveModel(s.working, s.tuning) : null), [s.working, s.tuning]);

  // A corrected or re-tuned categorizer reads the next frame; leaving it stops the test.
  useEffect(() => {
    if (live) test.getState().retune(live);
    else test.getState().stop();
  }, [live, test]);
  useEffect(() => () => test.getState().stop(), [test]);

  if (!live || !s.working) return null;
  const correct = (id: string) => {
    const v = test.getState().capture();
    if (v) s.correct(id, v);
  };
  return (
    <section className="space-y-3 rounded-lg border border-emerald-400/20 p-2" data-faces-test>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <h4 className={heading}>Try it</h4>
          <button type="button" className={t.running ? btn : primary} onClick={() => (t.running ? t.stop() : t.start(live))}>
            {t.running ? 'Stop' : 'Test with my face'}
          </button>
        </div>
        {t.running ? (
          <>
            <Readout test={t} live={live} />
            <div className="space-y-1">
              <p className={hint}>Read wrong? Hold the face you meant and tell it which one it is:</p>
              <div className="flex flex-wrap gap-1.5">
                {live.model.categories.map((c) => (
                  <button key={c.id} type="button" className={btn} disabled={t.noFace || !t.reading} onClick={() => correct(c.id)} aria-label={`This face is ${c.label || c.id}`}>
                    This is {c.label || c.id}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className={hint}>Make your faces at the camera and see what this categorizer reads. The instrument stays quiet meanwhile.</p>
        )}
      </div>
      <div className="space-y-1.5" data-faces-checks>
        <h4 className={heading}>Check it</h4>
        <QuizBox session={session} test={test} live={live} />
        <EverydayBox session={session} test={test} live={live} />
      </div>
      <TuningDials s={s} live={live} />
      <div className="space-y-1.5">
        <h4 className={heading}>Add faces</h4>
        {(['samples', 'centroids'] as const).map((seed) => (
          <div key={seed} className="flex items-start gap-2">
            <button
              type="button"
              className={btn}
              onClick={() => {
                t.stop();
                s.startMerge(seed);
              }}
            >
              {MERGE_TEXT[seed].button}
            </button>
            <p className="text-[10px] leading-snug text-white/45">{MERGE_TEXT[seed].says}</p>
          </div>
        ))}
      </div>
      <ExportButton s={s} />
    </section>
  );
}

/** Save the open categorizer as a file (P1's versioned format; no pictures, no tuning). */
function ExportButton({ s }: { s: FaceSessionState }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={btn}
        onClick={() => downloadCategorizer(s.exportFile())}
      >
        Export file
      </button>
      <p className="text-[10px] leading-snug text-white/45">Your faces as numbers and names, to keep or move to another browser. No pictures.</p>
    </div>
  );
}

/** Save an exported categorizer as `<name>.categorizer.json` (nothing when there is none). */
export function downloadCategorizer(file: { name: string; text: string } | null): void {
  if (file) downloadText(`${file.name.replace(/[^\w.-]+/g, '_') || 'faces'}.categorizer.json`, file.text);
}

function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Open a categorizer file: validated, older versions migrated, shown unsaved. */
export function ImportButton({ s, confirmDiscard }: { s: FaceSessionState; confirmDiscard: () => boolean }) {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button type="button" className={btn} onClick={() => confirmDiscard() && input.current?.click()}>
        Import file
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label="Categorizer file"
        data-faces-import
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void file.text().then((text) => s.importFile(text));
        }}
      />
    </>
  );
}
