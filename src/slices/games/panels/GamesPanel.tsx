/**
 * The listening games' editor section: which game and lesson, how hard, Start and Stop, the live
 * line and the last results, and the timing take (Audio timing) with its "Keep" button, which
 * writes this device's offset. Every dial write goes through the dial dispatchers.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import { controls } from '@thoremin/sdk-ui/host';
import { Toggle, ValueRow, selectCls } from '@thoremin/sdk-ui/primitives';
import { lessonsFor } from '../lib/lessons';
import { DEFAULT_GAMES, DEFAULT_GAMES_PREFS, DIFFICULTIES, GAMES_PREFS, GAME_MODES, type GameMode, type GamesPrefs, type GamesSettings } from '../schema';
import { describeGame, useGamesStatus } from '../app/status';
import { keepOffset, startGame, stopGame } from '../app/controls';
import { lessonFor } from '../nodes/listening_game';

const KEY = 'games';

export const MODE_LABEL: Record<GameMode, string> = {
  sing: 'Sing',
  'play-along': 'Play along',
  match: 'Match the note',
  calibrate: 'Audio timing (calibrate)',
};

/** What each mode asks of the player, in one line. */
const MODE_HINT: Record<GameMode, string> = {
  sing: 'Sing the bars as they reach the line; the trail is your voice. Any octave counts unless you turn it off.',
  'play-along': 'Clap, tap or play each note as it reaches the line. Rhythm lessons need no pitch; melody lessons do.',
  match: 'Listen to the note, then sing or play it and hold it until the ring fills.',
  calibrate:
    'Tap the table or clap on each of the 16 clicks after the count-in. With headphones it measures you and the device together; with the speaker and no tapping it measures the device alone.',
};

/** A labelled select row (ValueRow shows a number; these show a choice). */
function SelectRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-white/70">{label}</span>
      {children}
    </label>
  );
}

function usePrefs(): GamesPrefs {
  return useSyncExternalStore(
    (l) => controls().subscribe(l),
    () => (controls().get()[GAMES_PREFS] as GamesPrefs | undefined) ?? DEFAULT_GAMES_PREFS,
  );
}

export function GamesReadout() {
  const live = useGamesStatus((s) => s.live);
  return <div className="text-xs text-white/80">{describeGame(live)}</div>;
}

export function GamesControls() {
  const { state } = useDialsSettings();
  const c: GamesSettings = { ...DEFAULT_GAMES, ...((state.effective[KEY] ?? {}) as Partial<GamesSettings>) };
  const live = useGamesStatus((s) => s.live);
  const prefs = usePrefs();
  const lessons = c.game === 'calibrate' ? [] : lessonsFor(c.game);
  const lesson = lessonFor(c);
  const running = live.phase === 'count-in' || live.phase === 'playing';
  const cal = live.calibration;
  return (
    <div className="space-y-2" data-testid="games-panel">
      <GamesReadout />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={c.enabled} onChange={(e) => dispatchDialSetIn(`${KEY}.enabled`, e.target.checked)} />
        Listening games on
      </label>
      <SelectRow label="Game">
        <select className={selectCls} value={c.game} onChange={(e) => dispatchDialSetIn(`${KEY}.game`, e.target.value)} aria-label="Game">
          {GAME_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </SelectRow>
      <p className="text-[10px] leading-relaxed text-white/50">{MODE_HINT[c.game]}</p>
      {lessons.length > 0 && (
        <SelectRow label="Lesson">
          <select className={selectCls} value={lesson?.id ?? ''} onChange={(e) => dispatchDialSetIn(`${KEY}.lesson`, e.target.value)} aria-label="Lesson">
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </SelectRow>
      )}
      {lesson?.hint ? <p className="text-[10px] text-white/50">{lesson.hint}</p> : null}
      {c.game !== 'calibrate' && (
        <>
          <SelectRow label="Difficulty">
            <select className={selectCls} value={c.difficulty} onChange={(e) => dispatchDialSetIn(`${KEY}.difficulty`, e.target.value)} aria-label="Difficulty">
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </SelectRow>
          <ValueRow label="Transpose (semitones)" value={c.transpose}>
            <input type="range" min={-12} max={12} step={1} value={c.transpose} className="w-28" onChange={(e) => dispatchDialSetIn(`${KEY}.transpose`, Number(e.target.value))} />
          </ValueRow>
          <Toggle label="Any octave counts" checked={c.octaveFold} onChange={(v) => dispatchDialSetIn(`${KEY}.octaveFold`, v)} />
          {c.game === 'sing' && <Toggle label="Play the first note in the count-in" checked={c.reference} onChange={(v) => dispatchDialSetIn(`${KEY}.reference`, v)} />}
        </>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={!c.enabled} className="rounded bg-emerald-600 px-3 py-1 text-xs disabled:opacity-40" onClick={startGame}>
          {running ? 'Restart' : 'Start'}
        </button>
        <button type="button" disabled={!running} className="rounded bg-white/10 px-3 py-1 text-xs disabled:opacity-40" onClick={stopGame}>
          Stop
        </button>
      </div>
      {live.results && <p className="text-xs text-white/80">Last: {live.results.summary}</p>}
      <p className="text-[10px] text-white/50">
        Timing offset on this device: {Math.round(prefs.offset * 1000)} ms
        {prefs.source === 'none' ? ' (not measured: choose Audio timing and Start)' : ` (${prefs.source}, spread ${Math.round((prefs.spread ?? 0) * 1000)} ms)`}
      </p>
      {cal && !cal.refusal && (
        <button
          type="button"
          className="rounded bg-white/10 px-3 py-1 text-xs"
          onClick={() => keepOffset({ offset: cal.offset, spread: cal.spread, source: 'tap', measuredAt: new Date().toISOString() })}
        >
          Keep {Math.round(cal.offset * 1000)} ms as this device's offset
        </button>
      )}
    </div>
  );
}
