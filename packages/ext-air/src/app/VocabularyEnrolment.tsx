/**
 * The enrolment step of an air instrument that reads a shape (#249): name a shape, press
 * Learn, make it when the countdown ends and hold it for two seconds. The guitar's chords
 * and the flute's fingerings are two uses of this one component; what differs is passed
 * in: the vocabulary store, where the live shape comes from, which names are valid, and
 * the words.
 *
 * Capture starts {@link ENROL_SETTLE_MS} after the countdown, so the frames of the hand
 * still moving INTO the shape are not learned as the shape. After every change the list
 * says which entries are too close to another to be told apart in play (the separation
 * ratio of `src/air/vocabulary.ts`), because two names on one shape just flip.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import { MIN_SAMPLES_PER_ENTRY, separation, trainVocabulary } from '../lib/vocabulary';
import type { FeatureVector } from '@thoremin/sdk/enroll';
import type { VocabularyState } from './vocabularyStore';

/** Seconds of countdown before a shape is captured: time to make it. */
export const ENROL_COUNTDOWN_S = 3;
/** Milliseconds after the countdown that are NOT captured: the hand settling into shape. */
export const ENROL_SETTLE_MS = 300;
/** Seconds a shape is held and captured (the research's two seconds per chord). */
export const ENROL_CAPTURE_S = 2;
/** How often the capture polls the live shape, ms (faster than the camera: each new
 *  frame is taken once). */
const POLL_MS = 30;
/** Below this separation (nearest other entry, in the entry's own spreads) two entries
 *  are likely to flip in play. */
const CLOSE_RATIO = 2;

export interface EnrolmentWords {
  /** "Your chords". */
  title: string;
  /** "chord" — used in the prompts. */
  noun: string;
  /** What to do, shown while nothing is enrolled. */
  intro: string;
  /** The name input's placeholder and accessible label. */
  placeholder: string;
  inputLabel: string;
  /** Shown under an invalid name. */
  invalidHint: string;
  /** Shown while the instrument is off. */
  offHint: string;
  /** Shown when nothing was seen during a capture. */
  noShapeError: string;
}

export interface VocabularyEnrolmentProps {
  enabled: boolean;
  useVocabulary: UseBoundStore<StoreApi<VocabularyState>>;
  /** The instrument node's live shape (the capture polls it). */
  readShape: () => FeatureVector | null;
  /** The canonical name for what the player typed, or null when it is not a valid name. */
  canonical: (typed: string) => string | null;
  words: EnrolmentWords;
  /**
   * A FIXED vocabulary (the flute's two mouth states): one Learn button per label and no
   * name field. Absent = the player names each entry (chords, notes).
   */
  fixedLabels?: readonly string[];
}

type Phase = { kind: 'idle' } | { kind: 'countdown'; label: string; left: number } | { kind: 'capture'; label: string; got: number };

export function VocabularyEnrolment({ enabled, useVocabulary, readShape, canonical, words, fixedLabels }: VocabularyEnrolmentProps) {
  const { vocab, enrol, remove, error: saveError } = useVocabulary();
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const clear = () => {
    for (const t of timers.current) clearInterval(t);
    timers.current = [];
  };
  useEffect(() => clear, []);

  const valid = name.trim() ? canonical(name) : null;
  const busy = phase.kind !== 'idle';
  const close = useMemo(() => {
    const model = trainVocabulary(vocab);
    if (!model || model.categories.length < 2) return new Map<string, string>();
    return new Map(separation(model).filter((s) => s.ratio < CLOSE_RATIO).map((s) => [s.label, s.nearest]));
  }, [vocab]);

  const learn = (label: string) => {
    setError(null);
    clear();
    let left = ENROL_COUNTDOWN_S;
    setPhase({ kind: 'countdown', label, left });
    const countdown = setInterval(() => {
      left -= 1;
      if (left > 0) return setPhase({ kind: 'countdown', label, left });
      clearInterval(countdown);
      const samples: FeatureVector[] = [];
      let last: FeatureVector | null = readShape();
      const started = Date.now();
      setPhase({ kind: 'capture', label, got: 0 });
      const poll = setInterval(() => {
        const elapsed = Date.now() - started;
        const v = readShape();
        if (v && v !== last && elapsed >= ENROL_SETTLE_MS) {
          samples.push(v);
          setPhase({ kind: 'capture', label, got: samples.length });
        }
        last = v;
        if (elapsed < ENROL_SETTLE_MS + ENROL_CAPTURE_S * 1000) return;
        clear();
        setPhase({ kind: 'idle' });
        if (samples.length < MIN_SAMPLES_PER_ENTRY) {
          setError(words.noShapeError);
          return;
        }
        void enrol(label, samples);
        setName('');
      }, POLL_MS);
      timers.current.push(poll);
    }, 1000);
    timers.current.push(countdown);
  };

  return (
    <div className="space-y-2 rounded-lg border border-white/10 p-2" data-testid="shape-enrolment">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">{words.title}</div>
      {vocab.entries.length === 0 ? (
        <p className="text-[10px] leading-relaxed text-white/50">{words.intro}</p>
      ) : (
        <ul className="space-y-1">
          {vocab.entries.map((e) => (
            <li key={e.label} className="flex items-center justify-between gap-2 text-xs">
              <span>
                <span className="font-mono text-emerald-300">{e.label}</span>
                <span className="ml-2 text-[10px] text-white/40">{e.samples.length} samples</span>
                {canonical(e.label) === null && <span className="ml-2 text-[10px] text-amber-300">not a valid name</span>}
                {close.has(e.label) && (
                  <span className="ml-2 text-[10px] text-amber-300" title="Hold the two more differently, or re-learn one">
                    looks like {close.get(e.label)}
                  </span>
                )}
              </span>
              <span className="flex gap-1">
                {/* A fixed vocabulary re-learns from its own buttons below (one control per label). */}
                {!fixedLabels && (
                  <button
                    className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/20 disabled:opacity-40"
                    disabled={busy || !enabled}
                    onClick={() => learn(e.label)}
                    aria-label={`Re-learn ${e.label}`}
                  >
                    Re-learn
                  </button>
                )}
                <button
                  className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/20 disabled:opacity-40"
                  disabled={busy}
                  onClick={() => void remove(e.label)}
                  aria-label={`Forget ${e.label}`}
                >
                  Forget
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {fixedLabels ? (
        <div className="flex flex-wrap gap-1">
          {fixedLabels.map((label) => {
            const learned = vocab.entries.some((e) => e.label === label);
            return (
              <button
                key={label}
                className="rounded bg-emerald-500 px-2 py-1 text-xs font-semibold text-black transition hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/40"
                disabled={!enabled || busy}
                onClick={() => learn(label)}
              >
                {learned ? `Re-learn ${label}` : `Learn ${label}`}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex gap-1">
          <input
            className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-xs outline-none placeholder:text-white/30 focus:bg-white/20"
            placeholder={words.placeholder}
            aria-label={words.inputLabel}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid && enabled && !busy) learn(valid);
            }}
          />
          <button
            className="rounded bg-emerald-500 px-2 py-1 text-xs font-semibold text-black transition hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/40"
            disabled={!valid || !enabled || busy}
            onClick={() => valid && learn(valid)}
          >
            Learn
          </button>
        </div>
      )}
      {name.trim() && !valid && <p className="text-[10px] text-amber-300">{words.invalidHint}</p>}
      {!enabled && <p className="text-[10px] text-white/50">{words.offHint}</p>}
      {phase.kind === 'countdown' && (
        <p className="text-sm font-semibold text-amber-200" role="status">
          Make your {phase.label} {words.noun}… {phase.left}
        </p>
      )}
      {phase.kind === 'capture' && (
        <p className="text-sm font-semibold text-emerald-300" role="status">
          Hold {phase.label}… ({phase.got} samples)
        </p>
      )}
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
      {saveError && <p className="text-[10px] text-rose-300">{saveError}</p>}
    </div>
  );
}
