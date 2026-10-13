/**
 * The Song tool panel (#186 PR G) — load a song to dance to, and see its beat.
 *
 * The shell entry point for the song half of the body epic (research map §9.5): choose
 * an audio file, and the panel decodes it, runs the beat tracker (`@thoremin/ictus`
 * `trackSongGrid`) and makes it the loaded song in the hot store, where the trunk's
 * `song-player` node picks it up. It then shows what the tracker found (the tempo, how
 * sure it is, how many beats) and, while the song plays, the beat tracker live: a beat
 * counter that flashes on each beat, the tempo as heard at the current rate, the
 * position. Play and Pause go through the `song.play` / `song.pause` commands (the single
 * write path, #87); the level and the tempo are the `song.volume` / `song.rate` dials,
 * dragged directly (Decision B: a slider drag is the one place latency is audible).
 *
 * The song keeps playing with the panel closed, so the tool runs detached and the bar
 * carries its stop control (`ToolsBar`).
 */
import { useRef, useState } from 'react';
import { Disc3, X } from 'lucide-react';
import { LoadStatusReadout } from './LoadStatusReadout';
import { dispatchCommand } from './dispatchDial';
import { useDialsSettings } from './dials/useDialsSettings';
import { useControls } from './store';
import { useSongStatus, type SongLive } from './songStatus';
import { loadSongFile, unloadSong } from './song/host';
import { toolById } from './tools';
import { useTools } from './toolsStore';
import { DEFAULT_SONG, SONG_RATE_MAX, SONG_RATE_MIN } from '@/settings/schema';
import type { SongHandle } from '@/nodes/output/song_player';

export const SONG_TOOL_ID = 'song';

/** "3:07" from seconds. */
export function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** What the tracker found, in words. */
export function describeGrid(song: SongHandle): string {
  const g = song.grid;
  if (!(g.periodS > 0)) return 'No steady beat found in this file.';
  const sure = g.confidence >= 0.5 ? 'a clear beat' : g.confidence >= 0.25 ? 'a fair beat' : 'a faint beat';
  return `${g.bpm.toFixed(1)} bpm, ${sure} (${g.beats.length} beats tracked).`;
}

function BeatTracker({ live, playing }: { live: SongLive; playing: boolean }) {
  // The flash alternates per beat, so every beat is a visible change.
  const on = playing && live.beat % 2 === 0;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-2 text-xs" data-testid="song-live" data-beat={live.beat}>
      <span
        aria-hidden
        className={`h-3 w-3 rounded-full transition-colors duration-75 ${on ? 'bg-emerald-400' : playing ? 'bg-emerald-900' : 'bg-white/20'}`}
      />
      <span className="font-mono text-white/80">beat {Math.max(0, live.beat + 1)}</span>
      <span className="font-mono text-emerald-300">{live.bpm > 0 ? `${live.bpm.toFixed(1)} bpm` : '-'}</span>
      <span className="ml-auto font-mono text-white/50">{formatTime(live.positionS)}</span>
    </div>
  );
}

export default function SongPanel() {
  const open = useTools((s) => s.open) === SONG_TOOL_ID;
  const close = useTools((s) => s.close);
  const song = useControls((s) => s.songHandle);
  const playing = useControls((s) => s.songPlaying);
  const status = useSongStatus((s) => s.status);
  const live = useSongStatus((s) => s.live);
  const { state, set } = useDialsSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const tool = toolById(SONG_TOOL_ID);
  const volume = (state.effective['song.volume'] as number | undefined) ?? DEFAULT_SONG.volume;
  const rate = (state.effective['song.rate'] as number | undefined) ?? DEFAULT_SONG.rate;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await loadSongFile(file);
    } catch {
      setError(`${file.name} could not be decoded. Try an MP3, M4A, WAV, OGG or FLAC file.`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="shell-tool-panel absolute left-3 z-40 flex w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/70 backdrop-blur" data-testid="song-panel">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Disc3 className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-white/70">Song</span>
        <button onClick={close} aria-label="Close the Song tool" className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 overflow-auto p-4">
        {tool && <p className="text-[10px] uppercase tracking-widest text-emerald-500/70">{tool.description}</p>}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          data-testid="song-file"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
        >
          {busy ? 'Finding the beat...' : song ? 'Choose another song...' : 'Choose a song...'}
        </button>
        {error && <p className="text-[11px] text-amber-300/90">{error}</p>}
        {song && (
          <>
            <div className="space-y-0.5 text-xs">
              <div className="truncate font-semibold text-white/90" title={song.name}>
                {song.name} <span className="font-normal text-white/40">{formatTime(song.durationS)}</span>
              </div>
              <div className="text-white/60" data-testid="song-grid">{describeGrid(song)}</div>
            </div>
            <button
              onClick={() => void dispatchCommand(playing ? 'song.pause' : 'song.play', {})}
              className={`w-full rounded-lg px-3 py-2 text-sm font-semibold transition ${
                playing ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-emerald-500 text-black hover:bg-emerald-400'
              }`}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <BeatTracker live={live} playing={playing && status.phase === 'active'} />
            <LoadStatusReadout status={status} enabled offMessage="No song loaded" />
            <label className="flex items-center justify-between gap-2 text-xs text-white/80">
              Volume
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => set('song.volume', Number(e.target.value))} />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-white/80">
              <span>
                Tempo <span className="font-mono text-white/50">{Math.round(rate * 100)}%</span>
              </span>
              <input
                type="range"
                min={SONG_RATE_MIN}
                max={SONG_RATE_MAX}
                step={0.01}
                value={rate}
                onChange={(e) => set('song.rate', Number(e.target.value))}
              />
            </label>
            <button onClick={unloadSong} className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white/70">
              Unload the song
            </button>
          </>
        )}
        <p className="text-[10px] leading-relaxed text-white/50">
          The song stays on this device: it is decoded and its beat tracked in the browser, and it is never saved with an
          instrument. The tempo slider changes the speed without changing the pitch.
        </p>
      </div>
    </div>
  );
}
