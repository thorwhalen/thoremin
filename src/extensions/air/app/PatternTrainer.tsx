/**
 * The pattern trainer (#269), in the air drum's settings: pick a pattern, hear a count-
 * in, play it through a few times, and the fit learns your tempo, your feel and where
 * you strike each drum.
 *
 * What happens on Start (the design's three decisions, `docs/research/drum-pattern-
 * training.md` §4): the trainer's own click player counts a bar in at the pattern's
 * tempo and clicks through the first pass (all passes with "click throughout"); the
 * strip's cursor runs on that clock for the whole take (a follower-driven cursor is the
 * next step); the instrument sounds the player's hits exactly as it does outside
 * training (the raw hit is the evidence); the hits are read from the node's hit tap when
 * the take ends and fitted. The result (tempo, recall, the feel per event as a tint on
 * the strip, the pads per drum) is shown and saved as the pattern's model, which the
 * playback mode reads.
 *
 * The take's clock is `performance.now()`, the engine clock in milliseconds (the hit
 * tap's `t` is the same clock in seconds). Nothing here touches the tick loop.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { DRUM_PATTERNS, patternById, type DrumPattern } from '@thoremin/sdk/music/drum_patterns';
import { fitPattern, playbackOffset, type PatternModel } from '@thoremin/sdk/drums/pattern_fit';
import type { Click } from '@thoremin/sdk/enroll';
import { clickPlayer } from '@/app/enroll/click';
import { hitsSince } from '@/extensions/air/app/hitsTap';
import { loadPatternModel, removePatternModel, savePatternModel } from '@/extensions/air/app/patternModels';
import { refreshPatternPlay } from '@/extensions/air/app/patternPlaySync';
import { TRAINING_ANCHORS } from '@/extensions/air/training';
import { useControls } from '@/app/store';
import { PatternStrip } from '@/extensions/air/app/PatternStrip';

/** Bars of count-in before the pattern starts. */
const COUNT_IN_BARS = 1;
const BEATS_PER_BAR = 4;
/** How often the cursor and the clock are advanced, ms. */
const TICK_MS = 40;
/** Seconds after the last beat the take keeps listening: a late last hit still counts. */
const TAIL_S = 0.4;

export interface PatternTrainerProps {
  enabled: boolean;
  /** For tests: the clock. Default `performance.now`. */
  now?: () => number;
}

type Phase = { kind: 'idle' } | { kind: 'count-in'; startMs: number } | { kind: 'playing'; startMs: number; patternStartMs: number } | { kind: 'fitting' } | { kind: 'done'; model: PatternModel | null };

/** The click schedule for a take: a count-in bar, then a click on every beat of the
 *  first `clickPasses` passes, the first beat of each bar accented. */
export function takeClicks(pattern: DrumPattern, passes: number, clickPasses: number, startMs: number): { clicks: Click[]; patternStartMs: number; endMs: number } {
  const beatMs = 60000 / pattern.bpm;
  const clicks: Click[] = [];
  const countIn = COUNT_IN_BARS * BEATS_PER_BAR;
  for (let i = 0; i < countIn; i++) clicks.push({ t: startMs + i * beatMs, kind: 'count', index: i, accent: i === 0 });
  const patternStartMs = startMs + countIn * beatMs;
  const beatsClicked = Math.min(passes, clickPasses) * pattern.lengthBeats;
  for (let b = 0; b < beatsClicked; b++) {
    clicks.push({ t: patternStartMs + b * beatMs, kind: 'beat', index: b, accent: b % BEATS_PER_BAR === 0 });
  }
  return { clicks, patternStartMs, endMs: patternStartMs + passes * pattern.lengthBeats * beatMs };
}

export function PatternTrainer({ enabled, now = () => performance.now() }: PatternTrainerProps) {
  const [patternId, setPatternId] = useState(DRUM_PATTERNS[0]?.id ?? '');
  const [passes, setPasses] = useState(4);
  const [clickThroughout, setClickThroughout] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [cursor, setCursor] = useState<number | null>(null);
  const [saved, setSaved] = useState<PatternModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pattern = useMemo(() => patternById(patternId) ?? DRUM_PATTERNS[0] ?? null, [patternId]);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    return () => {
      stopTimer();
      clickPlayer().stop();
      // Unmounted mid-take: the take is not fitted (there is nobody to show it to), but
      // the pattern mode must come back.
      refreshPatternPlay();
    };
  }, []);

  // The model on record for the chosen pattern.
  useEffect(() => {
    let live = true;
    if (!pattern) return;
    void loadPatternModel(pattern.id)
      .then((m) => live && setSaved(m))
      .catch(() => live && setSaved(null));
    return () => {
      live = false;
    };
  }, [pattern, phase.kind]);

  const finish = async (p: DrumPattern, patternStartMs: number) => {
    stopTimer();
    setCursor(null);
    setPhase({ kind: 'fitting' });
    // The RAW strike time: `t` is when the hit sounded, which a magnet or a pattern in
    // play may have moved; `pull` is by how much. (The pattern mode is also off for the
    // take, see `start`, so the sound is the pad's own.)
    const hits = hitsSince(patternStartMs / 1000 - 0.25).map((h) => ({ t: h.t - h.pull, sound: h.sound, pad: h.pad, x: h.x, y: h.y }));
    const model = fitPattern(hits, p, { statedBpm: p.bpm, takenAt: Date.now() });
    if (model) {
      try {
        await savePatternModel(model);
        setError(null);
      } catch (e) {
        setError(`Could not save (${e instanceof Error ? e.message : 'storage failed'}).`);
      }
    }
    // The pattern mode comes back (with the new model, if it plays this pattern).
    refreshPatternPlay();
    setPhase({ kind: 'done', model });
  };

  const start = () => {
    if (!pattern || !enabled) return;
    setError(null);
    // No pattern in play during a take: the take must be the player's strokes, not the
    // mode's snapped output (fitting that would only reproduce the old model).
    useControls.getState().setAirDrumPattern(null);
    const player = clickPlayer();
    player.unlock?.();
    const startMs = now() + 200;
    const plan = takeClicks(pattern, passes, clickThroughout ? passes : 1, startMs);
    player.play(plan.clicks);
    setPhase({ kind: 'count-in', startMs });
    setCursor(null);
    const beatMs = 60000 / pattern.bpm;
    stopTimer();
    timer.current = setInterval(() => {
      const t = now();
      if (t < plan.patternStartMs) {
        setCursor(null);
        return;
      }
      if (t >= plan.endMs + TAIL_S * 1000) {
        void finish(pattern, plan.patternStartMs);
        return;
      }
      setPhase((ph) => (ph.kind === 'count-in' ? { kind: 'playing', startMs, patternStartMs: plan.patternStartMs } : ph));
      setCursor((t - plan.patternStartMs) / beatMs);
    }, TICK_MS);
  };

  const stop = () => {
    clickPlayer().stop();
    stopTimer();
    setCursor(null);
    setPhase({ kind: 'idle' });
    refreshPatternPlay();
  };

  const forget = async () => {
    if (!pattern) return;
    await removePatternModel(pattern.id);
    setSaved(null);
  };

  if (!pattern) return null;
  const running = phase.kind === 'count-in' || phase.kind === 'playing';
  const model = phase.kind === 'done' ? phase.model : saved;
  const shade = model ? (i: number) => (playbackOffset(model, i) > 0 ? 'rgb(251,146,60)' : playbackOffset(model, i) < 0 ? 'rgb(96,165,250)' : undefined) : undefined;
  return (
    <div id={TRAINING_ANCHORS.drumPatterns} className="space-y-2 rounded-lg border border-white/10 p-2" data-testid="pattern-trainer" data-phase={phase.kind}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Learn a drum pattern</div>
      <p className="text-[10px] leading-relaxed text-white/50">
        Pick a pattern, press Start: one bar of clicks counts you in at its tempo, then play it through {passes} times. The strip's cursor shows where you are.
        Afterwards the drum knows your tempo, where you strike each drum, and your feel on every hit; with the pattern mode on, what you play is snapped to the grid with your feel kept.
      </p>
      <div className="flex items-center gap-1">
        <select className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-xs" aria-label="Pattern" value={pattern.id} disabled={running} onChange={(e) => setPatternId(e.target.value)}>
          {DRUM_PATTERNS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.bpm} bpm)
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[10px] text-white/60">
          passes
          <input type="number" min={1} max={16} className="w-10 rounded bg-white/10 px-1 py-0.5 text-center text-xs" aria-label="Passes" value={passes} disabled={running} onChange={(e) => setPasses(Math.max(1, Math.min(16, Number(e.target.value) || 1)))} />
        </label>
      </div>
      <p className="text-[10px] text-white/40">{pattern.description}</p>
      <PatternStrip pattern={pattern} cursorBeat={cursor} shade={shade} />
      <div className="flex items-center gap-2">
        {!running ? (
          <button className="rounded bg-emerald-500 px-2 py-1 text-xs font-semibold text-black transition hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/40" disabled={!enabled || phase.kind === 'fitting'} onClick={start}>
            Start
          </button>
        ) : (
          <button className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20" onClick={stop}>
            Stop
          </button>
        )}
        <label className="flex items-center gap-1 text-[10px] text-white/60">
          <input type="checkbox" checked={clickThroughout} disabled={running} onChange={(e) => setClickThroughout(e.target.checked)} />
          click throughout
        </label>
        {phase.kind === 'count-in' && (
          <span className="text-xs font-semibold text-amber-200" role="status">
            Count-in…
          </span>
        )}
        {phase.kind === 'playing' && (
          <span className="text-xs font-semibold text-emerald-300" role="status">
            Play! pass {Math.min(passes, Math.floor((cursor ?? 0) / pattern.lengthBeats) + 1)} of {passes}
          </span>
        )}
        {phase.kind === 'fitting' && (
          <span className="text-xs text-white/60" role="status">
            Fitting…
          </span>
        )}
      </div>
      {!enabled && <p className="text-[10px] text-white/50">Turn the air drum on to train a pattern (it listens to its hits).</p>}
      {phase.kind === 'done' && !phase.model && (
        <p className="text-[10px] text-amber-300" role="status">
          Not enough hits matched the pattern. Play along with the count-in, and check the pads are on.
        </p>
      )}
      {model && (
        <div className="space-y-1 text-[10px] text-white/70" data-testid="pattern-model">
          <div>
            Your tempo <span className="font-mono text-emerald-300">{Math.round(model.bpm)}</span> bpm (counted in at {model.statedBpm}); {Math.round(model.recall * 100)}% of the hits found, {Math.round(model.precision * 100)}% of yours on the pattern.
          </div>
          <div>
            {Object.entries(model.positions).map(([drum, p]) => (
              <span key={drum} className="mr-2">
                {drum}: {p.pad ?? 'no pad'}
              </span>
            ))}
          </div>
          <div className="text-white/40">Tinted cells are your feel: orange late, blue early. Grey means on the grid.</div>
          {phase.kind !== 'done' && (
            <button className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/20" onClick={() => void forget()}>
              Forget this pattern's model
            </button>
          )}
        </div>
      )}
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}
