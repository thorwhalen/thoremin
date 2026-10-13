/**
 * The Conductor tool panel (#187 PR 4) — the shell entry point for conducting.
 *
 * The shipping rule: a capability nobody can find is not shipped. Conductor mode has
 * lived for a month as a settings section three clicks deep; this panel is the tools
 * bar button that says "Conductor", opens on one click, and shows a player everything
 * at once: a Start/Stop button (the `conductor.enabled` dial, through the single write
 * path), the piece and the follower controls (the same `ConductorControls` section as
 * the settings editor, so there is exactly one set of controls), and the live readout
 * the settings section deliberately does not carry — what the follower is doing right
 * now (waiting for a first stroke / running / holding), the tempo it is advancing at,
 * the beat in the bar, its confidence and the dynamics — from the engine loop's
 * reporter (`conductorStatus.ts`). The same beat is drawn over the video by the
 * overlay's `conductorHud` element, so the panel can be closed while conducting.
 *
 * "Conduct a recording" (#187 PR 7): the panel's second mode. The beat then leads a song
 * instead of the score (the `conductor.conducts` dial), through the same song player,
 * beat grid and pace-controller node the dancer's "Follow the dancer" uses (#186). The
 * song is chosen right here (the Song tool's own loader), so a cold load is four clicks:
 * Conductor, Conduct a recording, Choose a recording, Start conducting.
 *
 * "Conduct with" (#375): hands or body, the `conductor.source` dial. Body composes the
 * pose camera branch and the conductor reads it; from a cold load that is three clicks:
 * Conductor, Conduct with body, Start conducting.
 */
import { useRef, useState } from 'react';
import { Music2, X } from 'lucide-react';
import { unlockSongPlayback } from '@/nodes/output/song_player';
import { loadSongFile } from './song/host';
import { useControls } from './store';
import { dispatchCommand, dispatchDialSetIn } from './dispatchDial';
import { ConductorControls } from './dials/panels/conductor';
import { CONDUCTOR_SOURCES } from '@/nodes/features/conductor';
import { useDialsSettings } from './dials/useDialsSettings';
import { useConductorStatus, type ConductorLive } from './conductorStatus';
import { toolById } from './tools';
import { useTools } from './toolsStore';
import type { ConductorSettings } from '@/settings/schema';

export const CONDUCTOR_TOOL_ID = 'conductor';

/** What to tell the player, per follower state (and what they conduct with, #375). */
export function describeLive(live: ConductorLive, source: ConductorSettings['source'] = 'hands'): string {
  if (!live.enabled) return source === 'body' ? 'Off. Press Start, then beat time with your arm or a bounce.' : 'Off. Press Start, then beat time with your hand.';
  if (live.state === 'hold') return live.anchors === 0 ? 'Waiting for your first beat.' : 'Holding. Beat once to go on.';
  if (live.state === 'ready') return live.anchors === 0 ? 'Waiting for your first beat.' : 'Finding your tempo...';
  return `Following at ${Math.round(live.tempo)} bpm.`;
}

/** What the recording is doing while the beat leads it (#187 PR 7). */
export function describeRecording(rec: ConductorLive['recording']): string {
  if (!rec || rec.mode === 'idle') return 'The recording has no beat to follow.';
  if (rec.mode === 'cueing') return 'The recording waits on its first beat for yours.';
  if (rec.mode === 'holding') return 'The recording waits for your next beat.';
  const off = Math.round(rec.error * 100);
  return `Playing at ${Math.round(rec.rate * 100)} % speed, ${off === 0 ? 'on your beat' : `${Math.abs(off)} % of a beat ${off > 0 ? 'ahead' : 'behind'}`}.`;
}

/** The second mode: the beat leads a recording (#187 PR 7). */
function RecordingChooser({ live }: { live: ConductorLive }) {
  const song = useControls((s) => s.songHandle);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs" data-testid="conductor-recording">
      <input ref={fileRef} type="file" accept="audio/*" className="hidden" data-testid="conductor-recording-file" onChange={(e) => void onFile(e.target.files?.[0])} />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="w-full rounded bg-white/10 px-2 py-1.5 font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
      >
        {busy ? 'Finding the beat...' : song ? 'Choose another recording...' : 'Choose a recording...'}
      </button>
      {error && <p className="text-[11px] text-amber-300/90">{error}</p>}
      {song ? (
        <>
          <div className="truncate text-white/80" title={song.name}>{song.name}</div>
          {live.enabled && <div className="text-white/60" data-testid="conductor-recording-live">{describeRecording(live.recording)}</div>}
        </>
      ) : (
        <p className="text-white/50">Any song: its beat is found when it loads, and it follows yours.</p>
      )}
    </div>
  );
}

function LiveReadout({ live, source }: { live: ConductorLive; source: ConductorSettings['source'] }) {
  const beat = live.beatInBar + 1;
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs" data-testid="conductor-live" data-state={live.enabled ? live.state : 'off'}>
      <div className="flex items-center justify-between">
        <span className="text-white/80">{describeLive(live, source)}</span>
        {live.enabled && live.state === 'running' && (
          <span className="font-mono text-emerald-300">
            {beat}/{live.beatsPerBar}
          </span>
        )}
      </div>
      <Meter label="Confidence" value={live.confidence} />
      <Meter label="Dynamics" value={live.dynamics} />
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-2 text-[10px] text-white/50">
      <span className="w-16">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-white/10">
        <div className="h-full bg-emerald-400/70" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-mono">{pct}%</span>
    </div>
  );
}

export default function ConductorPanel() {
  const open = useTools((s) => s.open) === CONDUCTOR_TOOL_ID;
  const close = useTools((s) => s.close);
  const { state } = useDialsSettings();
  const live = useConductorStatus((s) => s.live);
  if (!open) return null;

  const tool = toolById(CONDUCTOR_TOOL_ID);
  const conductorDial = (state.effective.conductor ?? {}) as Partial<ConductorSettings>;
  const enabled = conductorDial.enabled === true;
  const recording = conductorDial.conducts === 'recording';
  const source = conductorDial.source === 'body' ? 'body' : 'hands';

  return (
    <div className="shell-tool-panel absolute left-3 z-40 flex w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Music2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-white/70">Conductor</span>
        <button
          onClick={close}
          aria-label="Close the Conductor"
          className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 overflow-auto p-4">
        {tool && <p className="text-[10px] uppercase tracking-widest text-emerald-500/70">{tool.description}</p>}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1 text-xs" role="radiogroup" aria-label="What the beat leads">
          {(
            [
              ['score', 'Conduct the score'],
              ['recording', 'Conduct a recording'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="radio"
              aria-checked={(value === 'recording') === recording}
              onClick={() => void dispatchDialSetIn('conductor.conducts', value)}
              className={`rounded px-2 py-1 font-semibold transition ${(value === 'recording') === recording ? 'bg-emerald-500 text-black' : 'text-white/70 hover:bg-white/10'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1 text-xs" role="radiogroup" aria-label="Conduct with">
          {CONDUCTOR_SOURCES.map((value) => (
            <button
              key={value}
              role="radio"
              aria-checked={value === source}
              onClick={() => void dispatchDialSetIn('conductor.source', value)}
              className={`rounded px-2 py-1 font-semibold transition ${value === source ? 'bg-emerald-500 text-black' : 'text-white/70 hover:bg-white/10'}`}
            >
              Conduct with {value}
            </button>
          ))}
        </div>
        {recording && <RecordingChooser live={live} />}
        <button
          onClick={() => {
            // Inside the click, before the tick that plays it: the media-element fallback's
            // autoplay policy (the Signalsmith worklet needs none).
            if (!enabled && recording) unlockSongPlayback();
            // Stopping hands the song back to the Song tool, paused, not to whatever its
            // transport said before the conductor took it.
            if (enabled && recording) void dispatchCommand('song.pause', {});
            void dispatchDialSetIn('conductor.enabled', !enabled);
          }}
          className={`w-full rounded-lg px-3 py-2 text-sm font-semibold transition ${
            enabled ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-emerald-500 text-black hover:bg-emerald-400'
          }`}
        >
          {enabled ? 'Stop conducting' : 'Start conducting'}
        </button>
        <LiveReadout live={live} source={source} />
        <p className="text-[10px] leading-relaxed text-white/50">
          {source === 'body'
            ? 'Stand back so the camera sees you from head to hips, and beat time with an arm or bounce with the trunk: the bottom of each bounce is a beat, bigger ones are louder.'
            : 'Beat time in front of the camera: the bottom of each stroke is a beat, bigger strokes are louder.'}{' '}
          The score waits for your first stroke, follows your tempo, and holds when you stop.
        </p>
        <ConductorControls sourceChooser={false} />
      </div>
    </div>
  );
}
