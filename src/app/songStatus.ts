/**
 * songStatus — the store the engine loop writes the `song-player` node's readout into
 * (#186 PR G), so the Song tool can say what the song is doing (loading, ready, playing,
 * finished, or waiting for the audio) and show the beat tracker live: the beat, the
 * tempo at the current rate, and the position. Ephemeral runtime state, like
 * `orchestraStatus`; the reporter is change-gated (a new beat, a new status), so it
 * writes a few times a second rather than every frame.
 *
 * It also closes the transport's loop: a song that plays to its end turns `songPlaying`
 * back off, so the next press of Play is a fresh start rather than a no-op.
 */
import { create } from 'zustand';
import type { LoadStatus } from '@thoremin/lazy';
import type { MusicalTime } from '@thoremin/ictus';
import type { OutputReader } from './generativeStatus';

export const SONG_NODE_ID = 'songPlayer';

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

export interface SongStatusState {
  status: LoadStatus;
  live: SongLive;
  report(status: LoadStatus, live: SongLive): void;
  reset(): void;
}

export const useSongStatus = create<SongStatusState>((set) => ({
  status: ABSENT_SONG_STATUS,
  live: ABSENT_SONG_LIVE,
  report: (status, live) => set({ status, live }),
  reset: () => set({ status: ABSENT_SONG_STATUS, live: ABSENT_SONG_LIVE }),
}));

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
  let wasEnded = false;
  return () => {
    const s = engine.getOutput(SONG_NODE_ID, 'status') as LoadStatus | undefined;
    if (!s) return;
    const time = engine.getOutput(SONG_NODE_ID, 'songTime') as MusicalTime | undefined;
    const position = engine.getOutput(SONG_NODE_ID, 'position') as number | undefined;
    const live: SongLive = {
      beat: time && time.state !== 'ready' ? Math.floor(time.beat) : 0,
      bpm: time && time.state !== 'ready' ? Math.round(time.tempo * 10) / 10 : 0,
      positionS: typeof position === 'number' ? position : 0,
    };
    const ended = s.reason === 'ended';
    if (ended && !wasEnded) onEnded();
    wasEnded = ended;
    // Whole seconds of position are enough for the readout; the beat drives the flash.
    const key = `${s.phase}|${s.reason ?? ''}|${s.message}|${live.beat}|${live.bpm}|${Math.floor(live.positionS)}`;
    if (key === lastKey) return;
    lastKey = key;
    store.report(s, live);
  };
}
