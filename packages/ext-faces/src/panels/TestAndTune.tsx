/**
 * The open categorizer's live half (#330 P3): try it (a live readout: which category, the
 * memberships, "none of these"), correct it ("this face is X", or record more faces and merge
 * them in), tune it (sensitivity, reject radius, distance; at classification time, no
 * retraining), and carry it as a file (export; import is beside the saved list).
 *
 * Rendering only: the actions are the session store's (`../app/sessionStore.ts`) and the test
 * store's (`../app/testStore.ts`); what a tuning means is `../lib/live.ts`.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { FaceSessionState, MergeSeed } from '../app/sessionStore';
import type { FaceTestState } from '../app/testStore';
import { liveModel, TUNING_BOUNDS, type LiveModel, type Tuning } from '../lib/live';

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

function Readout({ test, live }: { test: FaceTestState; live: LiveModel }) {
  const r = test.reading;
  const headline = test.noFace ? 'No face in view' : !r ? 'Reading...' : r.label ? r.label : r.rejected ? 'None of these' : 'Settling...';
  return (
    <div className="space-y-1.5" data-faces-readout>
      <p className="text-base font-bold text-white" role="status" aria-live="polite" data-faces-reading={r?.categoryId ?? (r?.rejected ? 'none' : '')}>
        {headline}
      </p>
      <ul className="space-y-0.5">
        {live.model.categories.map((c) => {
          const m = r?.memberships.find((x) => x.id === c.id)?.value ?? 0;
          const on = r?.categoryId === c.id;
          return (
            <li key={c.id} className="flex items-center gap-2 text-[10px]">
              <span className={`w-24 shrink-0 truncate ${on ? 'font-semibold text-emerald-200' : 'text-white/60'}`}>{c.label || c.id}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded bg-white/10">
                <span className={`block h-full ${r?.rejected ? 'bg-white/25' : on ? 'bg-emerald-400' : 'bg-white/50'}`} style={{ width: `${Math.round(m * 100)}%` }} />
              </span>
              <span className="w-8 shrink-0 text-right text-white/40">{Math.round(m * 100)}%</span>
            </li>
          );
        })}
      </ul>
      {r && (
        <p className="text-[10px] text-white/40">
          {r.radius === null
            ? `Distance to the nearest category: ${r.distance.toFixed(1)}. Every face is a category, so nothing reads as none of these.`
            : `Distance to the nearest category: ${r.distance.toFixed(1)}; beyond ${r.radius.toFixed(1)} a face is none of these.`}
        </p>
      )}
    </div>
  );
}

function Dial({ label, value, k, disabled, says, onChange }: { label: string; value: number; k: keyof Tuning; disabled?: boolean; says: string; onChange: (v: number) => void }) {
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
      <p className="text-[10px] leading-snug text-white/45">{says}</p>
    </div>
  );
}

function TuningDials({ s, live }: { s: FaceSessionState; live: LiveModel }) {
  const t = s.tuning;
  const partition = s.working?.mode === 'partition';
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
            ? 'Every face is a category here, so nothing is ever none of these: there is no radius to set.'
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
        onClick={() => {
          const file = s.exportFile();
          if (file) downloadText(`${file.name.replace(/[^\w.-]+/g, '_') || 'faces'}.categorizer.json`, file.text);
        }}
      >
        Export file
      </button>
      <p className="text-[10px] leading-snug text-white/45">Your faces as numbers and names, to keep or move to another browser. No pictures.</p>
    </div>
  );
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
