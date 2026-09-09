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
 */
import { Music2, X } from 'lucide-react';
import { dispatchDialSetIn } from './dispatchDial';
import { ConductorControls } from './dials/panels/conductor';
import { useDialsSettings } from './dials/useDialsSettings';
import { useConductorStatus, type ConductorLive } from './conductorStatus';
import { toolById } from './tools';
import { useTools } from './toolsStore';
import type { ConductorSettings } from '@/settings/schema';

export const CONDUCTOR_TOOL_ID = 'conductor';

/** What to tell the player, per follower state. */
export function describeLive(live: ConductorLive): string {
  if (!live.enabled) return 'Off. Press Start, then beat time with your hand.';
  if (live.state === 'hold') return live.anchors === 0 ? 'Waiting for your first beat.' : 'Holding. Beat once to go on.';
  if (live.state === 'ready') return live.anchors === 0 ? 'Waiting for your first beat.' : 'Finding your tempo...';
  return `Following at ${Math.round(live.tempo)} bpm.`;
}

function LiveReadout({ live }: { live: ConductorLive }) {
  const beat = live.beatInBar + 1;
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs" data-testid="conductor-live" data-state={live.enabled ? live.state : 'off'}>
      <div className="flex items-center justify-between">
        <span className="text-white/80">{describeLive(live)}</span>
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
  const enabled = ((state.effective.conductor ?? {}) as Partial<ConductorSettings>).enabled === true;

  return (
    <div className="absolute bottom-14 left-3 z-40 flex max-h-[calc(100dvh-5rem)] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/70 backdrop-blur">
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
        <button
          onClick={() => void dispatchDialSetIn('conductor.enabled', !enabled)}
          className={`w-full rounded-lg px-3 py-2 text-sm font-semibold transition ${
            enabled ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-emerald-500 text-black hover:bg-emerald-400'
          }`}
        >
          {enabled ? 'Stop conducting' : 'Start conducting'}
        </button>
        <LiveReadout live={live} />
        <p className="text-[10px] leading-relaxed text-white/50">
          Beat time in front of the camera: the bottom of each stroke is a beat, bigger strokes
          are louder. The score waits for your first stroke, follows your tempo, and holds when
          you stop.
        </p>
        <ConductorControls />
      </div>
    </div>
  );
}
