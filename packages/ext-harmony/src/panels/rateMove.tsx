/**
 * "Rate this move" (#715): a practice in the Chord map section. It plays a move between two of a
 * key's chords and asks where it sits, dark to bright and settled to tense; the ratings become the
 * player's own move captions ("Yours" in Move captions). The moves least rated come first, so
 * every one gets heard; a move rated again moves its words toward the newer ratings.
 */
import { useEffect, useState } from 'react';
import { RATING_MODES, moveKey, moveName, nextMoveToRate, ratedCount, ratingWords, type RatingMode, type RatingsTable } from '@thoremin/sdk/harmony/ratings';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { moveRatingsBook } from '../app/moveRatings';
import { playMove } from '../app/movePlayer';

const MOVES_PER_MODE = 42;

export function RateThisMove() {
  const [mode, setMode] = useState<RatingMode>('major');
  const [table, setTable] = useState<RatingsTable>({});
  const [move, setMove] = useState(() => nextMoveToRate({}, 'major'));
  const [valence, setValence] = useState(0);
  const [tension, setTension] = useState(0);
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    let live = true;
    void moveRatingsBook()
      .publish()
      .then((t) => {
        if (!live) return;
        setTable(t);
        setMove(nextMoveToRate(t, mode));
      });
    return () => {
      live = false;
    };
  }, [mode]);

  const fresh = (t: RatingsTable, avoid?: { from: number; to: number }) => {
    setMove(nextMoveToRate(t, mode, { avoid }));
    setValence(0);
    setTension(0);
    setPlayed(false);
  };
  const save = async () => {
    const t = await moveRatingsBook().rate(mode, move.from, move.to, { valence, tension, at: Date.now() });
    setTable(t);
    fresh(t, move);
  };
  const rated = table[moveKey(mode, move.from, move.to)];

  return (
    <details className="rounded border border-white/10 px-2 py-1" data-testid="rate-this-move">
      <summary className="cursor-pointer text-xs">Rate this move</summary>
      <div className="mt-2 space-y-2">
        <p className="text-[10px] leading-relaxed text-white/50">
          Hear a move between two chords and say where it sits for you. Your ratings become your own words on the map's moves: choose "Yours" in Move captions.
        </p>
        <label className="flex items-center justify-between gap-2 text-xs">
          Keys
          <select className={selectCls} value={mode} onChange={(e) => setMode(e.target.value as RatingMode)}>
            {RATING_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span data-testid="rate-move-name">{moveName(mode, move.from, move.to)}</span>
          <button type="button" className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20" onClick={() => (playMove(mode, move.from, move.to), setPlayed(true))}>
            {played ? 'Play again' : 'Play'}
          </button>
        </div>
        <label className="block text-xs">
          <span className="flex justify-between text-white/60">
            <span>dark</span>
            <span>bright</span>
          </span>
          <input type="range" className="w-full" min={-1} max={1} step={0.1} value={valence} aria-label="Dark to bright" onChange={(e) => setValence(Number(e.target.value))} />
        </label>
        <label className="block text-xs">
          <span className="flex justify-between text-white/60">
            <span>settled</span>
            <span>tense</span>
          </span>
          <input type="range" className="w-full" min={-1} max={1} step={0.1} value={tension} aria-label="Settled to tense" onChange={(e) => setTension(Number(e.target.value))} />
        </label>
        <div className="flex items-center gap-2 text-xs">
          <button type="button" className="rounded bg-white/15 px-2 py-0.5 hover:bg-white/25 disabled:opacity-40" disabled={!played} title={played ? '' : 'Play the move first'} onClick={() => void save()}>
            Save rating
          </button>
          <button type="button" className="rounded px-2 py-0.5 text-white/60 hover:text-white" onClick={() => fresh(table, move)}>
            Another move
          </button>
        </div>
        <p className="text-[10px] text-white/50" data-testid="rate-move-progress">
          {ratedCount(table, mode)} of {MOVES_PER_MODE} moves rated in {mode} keys
          {rated ? `; this one reads "${ratingWords(rated)}" (${rated.n} rating${rated.n === 1 ? '' : 's'})` : ''}.
        </p>
      </div>
    </details>
  );
}
