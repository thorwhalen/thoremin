/**
 * The Song tool's surface (#186 PR G): load a song file, read its beat grid, and
 * play it at a rate — the manual `song.rate` dial today, the dancer's pulse when
 * the pace controller (PR H) is following.
 *
 * Reachability: the tool is registered in `src/app/tools.ts`, this panel renders
 * when it is the open one, and the tools bar shows a stop control while the song
 * plays with the panel shut (`runsDetached`). Cold load → Song → choose file: two
 * clicks; play is one more once the beat is read.
 *
 * Writes: the transport (`songPlaying`) and the loaded song are TRANSIENT store
 * state, not dials (a decoded file is not a preset), written directly like `muted`
 * and `steerPlaying`; the rate and volume are dials and go through the dispatchers.
 */
import { useRef, useState } from 'react';
import { Music, X } from 'lucide-react';
import { useControls } from './store';
import { useTools } from './toolsStore';
import { toolById } from './tools';
import { analyzeSong } from '@/song/analyze';
import { dispatchDialSet } from './dispatchDial';
import { useDialsSettings } from './dials/useDialsSettings';

const TOOL_ID = 'song';

export default function SongPanel() {
  const open = useTools((s) => s.open) === TOOL_ID;
  const close = useTools((s) => s.close);
  const song = useControls((s) => s.loadedSong);
  const playing = useControls((s) => s.songPlaying);
  const setLoadedSong = useControls((s) => s.setLoadedSong);
  const setSongPlaying = useControls((s) => s.setSongPlaying);
  const { state } = useDialsSettings();
  const rate = (state.effective['song.rate'] as number) ?? 1;
  const volume = (state.effective['song.volume'] as number) ?? 0.8;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!open) return null;

  const tool = toolById(TOOL_ID);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const handle = await analyzeSong(file);
      setLoadedSong(handle);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const grid = song?.grid;
  const hasBeat = !!grid && Number.isFinite(grid.bpm);

  return (
    <div className="absolute bottom-14 left-3 z-40 flex max-h-[calc(100dvh-5rem)] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Music className="h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-white/70">Song</span>
        <button onClick={close} aria-label="Close the Song tool" className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 overflow-auto p-4">
        {tool && <p className="text-[10px] uppercase tracking-widest text-sky-500/70">{tool.description}</p>}
        <label className="block text-xs">
          <span className="mb-1 block text-white/60">Song file (mp3, m4a, wav, ogg, flac)</span>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            aria-label="Song file"
            disabled={busy}
            className="block w-full text-[11px] text-white/70 file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-[11px] file:text-white/80"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        {busy && <p className="text-[10px] text-white/50">Reading the beat…</p>}
        {error && <p className="text-[10px] text-rose-300/80">{error}</p>}
        {song && (
          <div className="space-y-2 rounded-lg border border-white/10 p-2 text-[11px]">
            <p className="truncate text-white/80" title={song.name}>{song.name}</p>
            <p className="text-white/50" data-song-bpm={hasBeat ? grid.bpm.toFixed(1) : 'none'}>
              {hasBeat
                ? `${grid.bpm.toFixed(1)} bpm · beat every ${grid.periodS.toFixed(3)} s · confidence ${Math.round(grid.confidence * 100)} % · ${Math.round(song.durationS)} s`
                : 'No steady beat found — the song plays, but nothing can follow it.'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSongPlaying(!playing)}
                aria-label={playing ? 'Pause the song' : 'Play the song'}
                className="rounded bg-sky-500 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-black transition hover:brightness-110"
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoadedSong(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
                className="rounded bg-white/10 px-2 py-1 text-[10px] uppercase tracking-widest text-white/60 hover:bg-white/20"
              >
                Unload
              </button>
            </div>
          </div>
        )}
        <label className="flex items-center justify-between gap-2 text-xs">
          Rate {rate.toFixed(2)}×
          <input
            type="range" min={0.5} max={2} step={0.01} value={rate}
            aria-label="Song rate"
            onChange={(e) => dispatchDialSet('song.rate', Number(e.target.value))}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          Volume
          <input
            type="range" min={0} max={1} step={0.01} value={volume}
            aria-label="Song volume"
            onChange={(e) => dispatchDialSet('song.volume', Number(e.target.value))}
          />
        </label>
        <p className="text-[10px] leading-relaxed text-white/40">
          The song plays into the instrument's mix with its pitch preserved at any rate.
          Start the audio first (the big button) — the browser needs a gesture.
        </p>
      </div>
    </div>
  );
}
