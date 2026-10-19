/**
 * songStatus — the store the engine loop writes the `song-player` node's readout into
 * (#186 PR G), so the Song tool can say what the song is doing (loading, ready, playing,
 * finished, or waiting for the audio) and show the beat tracker live: the beat, the
 * tempo at the current rate, and the position. Ephemeral runtime state, like
 * `orchestraStatus`; the reporter is change-gated (a new beat, a new status), so it
 * writes a few times a second rather than every frame.
 *
 * While the song follows the dancer (#186 PR H), it also reports what the pace controller
 * is doing (waiting for the dancer, locking on, following at a ratio and rate, holding),
 * read off the `pace` node when the `song-pace` branch is composed.
 *
 * It also closes the transport's loop: a song that plays to its end, or that the browser
 * refused to start (`reason: 'autoplay'`), turns `songPlaying` back off, so the next press
 * of Play is a fresh start rather than a no-op.
 */
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import { create } from 'zustand';
import type { LoadStatus } from '@thoremin/lazy';
import type { MusicalTime, PaceMode, PaceState } from '@thoremin/ictus';
import type { OutputReader } from './generativeStatus';

export const SONG_NODE_ID = TRUNK.song;
/** The pace controller's id in the `song-pace` branch. */
export const PACE_NODE_ID = 'pace';

export const ABSENT_SONG_STATUS: LoadStatus = { phase: 'off', message: 'No song loaded' };

/** What the Song tool shows of the song as it plays. */
export interface SongLive {
  /** Whole beats since the first tracked beat (negative before it). */
  beat: number;
  /** Beats per minute as heard (the song's tempo times the rate); 0 without a grid. */
  bpm: number;
  /** Seconds into the song. */
  positionS: number;
}

export const ABSENT_SONG_LIVE: SongLive = { beat: 0, bpm: 0, positionS: 0 };

/** What the Song tool shows of the song following the dancer; null while it does not. */
export interface PaceReadout {
  mode: PaceMode;
  /** Song beats per dancer cycle (NaN without a relation). */
  ratio: number;
  /** The rate the song plays at, rounded to a percent. */
  rate: number;
  /** -1 slowing into phase, +1 speeding, 0 in phase. */
  nudge: -1 | 0 | 1;
}

export interface SongStatusState {
  status: LoadStatus;
  live: SongLive;
  pace: PaceReadout | null;
  report(status: LoadStatus, live: SongLive, pace?: PaceReadout | null): void;
  reset(): void;
}

export const useSongStatus = create<SongStatusState>((set) => ({
  status: ABSENT_SONG_STATUS,
  live: ABSENT_SONG_LIVE,
  pace: null,
  report: (status, live, pace = null) => set({ status, live, pace }),
  reset: () => set({ status: ABSENT_SONG_STATUS, live: ABSENT_SONG_LIVE, pace: null }),
}));

/** The pace controller's state as the Song tool shows it. */
export function paceReadout(p: PaceState | undefined): PaceReadout | null {
  if (!p) return null;
  return { mode: p.mode, ratio: p.ratio, rate: Math.round(p.rate * 100) / 100, nudge: p.nudge };
}

/**
 * The per-frame sink: report the player's status and beat when either changed, and call
 * `onEnded` once each time the song plays to its end.
 */
export function makeSongReporter(
  engine: OutputReader,
  store: Pick<SongStatusState, 'report'> = useSongStatus.getState(),
  onEnded: () => void = () => {},
): () => void {
  let lastKey = '';
  let lastStop: string | null = null;
  return () => {
    const s = engine.getOutput(SONG_NODE_ID, 'status') as LoadStatus | undefined;
    if (!s) return;
    const time = engine.getOutput(SONG_NODE_ID, 'songTime') as MusicalTime | undefined;
    const position = engine.getOutput(SONG_NODE_ID, 'position') as number | undefined;
    const pace = paceReadout(engine.getOutput(PACE_NODE_ID, 'pace') as PaceState | undefined);
    const live: SongLive = {
      beat: time && time.state !== 'ready' ? Math.floor(time.beat) : 0,
      bpm: time && time.state !== 'ready' ? Math.round(time.tempo * 10) / 10 : 0,
      positionS: typeof position === 'number' ? position : 0,
    };
    // A song that ended, or one the browser refused to start, is not playing: the
    // transport goes off so the next Play is a fresh press.
    // Keyed on the reason, not a flag: a finished song whose replay the browser refuses
    // goes straight from `ended` to `autoplay`, and that is a second stop.
    const stop = s.reason === 'ended' || s.reason === 'autoplay' ? s.reason : null;
    if (stop && stop !== lastStop) onEnded();
    lastStop = stop;
    // Whole seconds of position are enough for the readout; the beat drives the flash.
    const paceKey = pace ? `${pace.mode}|${pace.ratio}|${pace.rate}|${pace.nudge}` : '';
    const key = `${s.phase}|${s.reason ?? ''}|${s.message}|${live.beat}|${live.bpm}|${Math.floor(live.positionS)}|${paceKey}`;
    if (key === lastKey) return;
    lastKey = key;
    store.report(s, live, pace);
  };
}
