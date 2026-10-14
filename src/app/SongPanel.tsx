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
 * write path, #87); the level and the tempo are a per-device pref (`songPrefs`: the song
 * plays under any instrument, so they are not instrument settings), dragged directly
 * (Decision B: a slider drag is the one place latency is audible) and reachable from the
 * palette and the assistant as `song.volume.set` / `song.rate.set`.
 *
 * "Follow the dancer" (#186 PR H) makes the song's tempo follow the dancer's pulse (the
 * `song.follow.set` command; a per-device pref like the tempo, so loading an instrument
 * never changes it): the body camera starts while a song is loaded, and the panel says
 * what the pace controller is doing, from waiting for the dancer to following at a
 * ratio. The follow range slider is dragged directly (Decision B) and is
 * `song.followRange.set` on the palette.
 *
 * The song keeps playing with the panel closed, so the tool runs detached and the bar
 * carries its stop control (`ToolsBar`).
 */
import { useRef, useState } from 'react';
import { Disc3, X } from 'lucide-react';
import { LoadStatusReadout } from './LoadStatusReadout';
import { dispatchCommand } from './dispatchDial';
import { useControls } from './store';
import { useSongStatus, type PaceReadout, type SongLive } from './songStatus';
import { loadSongFile, unloadSong } from './song/host';
import { toolById } from './tools';
import { useTools } from './toolsStore';
import { SONG_FOLLOW_RANGE_MAX, SONG_FOLLOW_RANGE_MIN, SONG_RATE_MAX, SONG_RATE_MIN } from '@/settings/schema';
import { unlockSongPlayback, type SongHandle } from '@/nodes/output/song_player';
import { songConducted, songDanced, songFollows, type DerivationSettings } from '@/instruments/derive';

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

/** "4 song beats per cycle", or "2 cycles per beat" for a dancer quicker than the beat. */
export function describeRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '';
  if (ratio >= 1) return ratio === 1 ? 'one song beat per step' : `${Math.round(ratio)} song beats per step`;
  return `${Math.round(1 / ratio)} steps per song beat`;
}

/** What following is doing, in words. `playing` = the song is sounding. */
export function describePace(pace: PaceReadout | null, playing: boolean): string {
  if (!playing) return 'Follows the dancer once the song plays.';
  if (!pace) return 'Starting the body camera...';
  const at = `${Math.round(pace.rate * 100)}%`;
  switch (pace.mode) {
    case 'idle':
      return 'Follows the dancer once the song plays.';
    case 'waiting':
      return "Waiting for the dancer's pulse: dance in front of the camera, feet in view.";
    case 'locking':
      return `Found the dancer (${describeRatio(pace.ratio)}), locking on...`;
    case 'following':
      return `Following: ${describeRatio(pace.ratio)}, tempo ${at}${pace.nudge !== 0 ? ', bringing the beat into step' : ', in step'}.`;
    case 'switching':
      return `The dancer changed step (${describeRatio(pace.ratio)}): holding ${at} until it settles...`;
    case 'holding':
      return `Holding the tempo at ${at}: the dancer's pulse is unclear.`;
  }
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
  const pace = useSongStatus((s) => s.pace);
  const prefs = useControls((s) => s.songPrefs);
  const setPrefs = useControls((s) => s.setSongPrefs);
  // While the conductor leads the song (#187 PR 7) its transport and tempo are his.
  const conducted = useControls((s) => songConducted(s as unknown as DerivationSettings));
  // The Conductor tool's dancer leading the recording (#380), with this tool's own follow off.
  const dancedByConductor = useControls((s) => songDanced(s as unknown as DerivationSettings) && !songFollows(s as unknown as DerivationSettings));
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const tool = toolById(SONG_TOOL_ID);
  const { volume, rate, follow, followRange } = prefs;

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
              {conducted && <div className="text-emerald-300/80" data-testid="song-conducted">The conductor leads this song: it plays, holds and keeps time with the beat.</div>}
              {dancedByConductor && <div className="text-emerald-300/80" data-testid="song-danced">The dancer leads this song (the Conductor's Dance the orchestra): its tempo follows your steps.</div>}
            </div>
            <button
              onClick={() => {
                // Inside the click, before the tick that plays it: the autoplay policy.
                if (!playing) unlockSongPlayback();
                void dispatchCommand(playing ? 'song.pause' : 'song.play', {});
              }}
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
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setPrefs({ volume: Number(e.target.value) })} />
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
                onChange={(e) => setPrefs({ rate: Number(e.target.value) })}
              />
            </label>
            <div className="space-y-2 rounded-lg border border-white/10 p-2" data-testid="song-follow">
              <label className="flex items-center justify-between gap-2 text-xs text-white/80">
                Follow the dancer
                <input
                  type="checkbox"
                  checked={follow}
                  aria-label="Follow the dancer"
                  onChange={(e) => void dispatchCommand('song.follow.set', { follow: e.target.checked })}
                />
              </label>
              {follow && (
                <>
                  <p className="text-[11px] text-white/60" data-testid="song-pace">
                    {describePace(pace, playing && status.phase === 'active')}
                  </p>
                  <label className="flex items-center justify-between gap-2 text-xs text-white/80">
                    <span>
                      Range <span className="font-mono text-white/50">+-{Math.round(followRange * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min={SONG_FOLLOW_RANGE_MIN}
                      max={SONG_FOLLOW_RANGE_MAX}
                      step={0.01}
                      value={followRange}
                      onChange={(e) => setPrefs({ followRange: Number(e.target.value) })}
                    />
                  </label>
                </>
              )}
            </div>
            <button onClick={unloadSong} className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white/70">
              Unload the song
            </button>
          </>
        )}
        <p className="text-[10px] leading-relaxed text-white/50">
          The song stays on this device: it is decoded and its beat tracked in the browser, and it is never saved with an
          instrument. The tempo slider changes the speed without changing the pitch; following the dancer pulls it around
          that tempo, never further than the range.
        </p>
      </div>
    </div>
  );
}
