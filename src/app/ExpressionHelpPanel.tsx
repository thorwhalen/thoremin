/**
 * ExpressionHelpButton — a small info (ⓘ) icon for the facial-expression detector
 * that opens a help panel: where the model comes from, how to trigger each emotion
 * (especially the model's hard-to-detect ones), what channels it reads, and links
 * to reference imagery. Content lives in expressionHelp.ts (grounded in the actual
 * classifier prototypes). A plain React overlay — not a native dialog.
 */
import { useState, useEffect } from 'react';
import { EXPRESSION_HELP, HELP_REFERENCES, MODEL_ORIGIN } from './expressionHelp';

export function ExpressionHelpButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/30 text-[9px] font-bold italic text-white/60 transition hover:border-white/70 hover:text-white"
        title="How to trigger each expression"
        aria-label="Expression detector help"
        onClick={() => setOpen(true)}
      >
        i
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Expression detector help"
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-white/15 bg-neutral-900/95 p-4 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-widest text-white/80">
                Reading your expression
              </h2>
              <button
                type="button"
                className="-mt-1 px-1 text-lg leading-none text-white/50 hover:text-white"
                aria-label="Close help"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>

            <p className="mb-3 text-[11px] leading-relaxed text-white/55">{MODEL_ORIGIN}</p>

            <div className="space-y-2.5">
              {EXPRESSION_HELP.map((e) => (
                <div key={e.name} className="rounded border border-white/10 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold capitalize text-cyan-300">{e.name}</span>
                    {e.hardToDetect && (
                      <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300/90">
                        harder to detect
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] font-semibold text-white/80">{e.keyAction}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/55">{e.howTo}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/40">
                    <span className="text-white/55">Common slip:</span> {e.commonMistake}
                  </p>
                  {e.avoidConfusion && (
                    <p className="mt-0.5 text-[10px] leading-relaxed text-white/40">
                      <span className="text-white/55">Tell apart:</span> {e.avoidConfusion}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {e.blendshapes.map((b) => (
                      <span key={b} className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9px] text-white/45">
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 border-t border-white/10 pt-2">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-white/50">
                See the faces
              </p>
              <ul className="space-y-1">
                {HELP_REFERENCES.map((r) => (
                  <li key={r.url} className="text-[10px] leading-snug">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-cyan-300/90 underline hover:text-cyan-200"
                    >
                      {r.title}
                    </a>
                    <span className="text-white/35"> — {r.shows}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-white/40">
              Tip: if an expression won’t trigger, raise its <span className="text-white/60">sensitivity</span>{' '}
              slider (in Expression sensitivity / mapping) — that lowers its trigger bar.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
