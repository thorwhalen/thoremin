/**
 * The Air drum tool panel (#233) — the shell entry point for drumming in the air.
 *
 * The shipping rule: a capability nobody can find is not shipped. This panel is the
 * tools bar button that says "Air drum", opens on one click, and shows a player
 * everything at once: a Start/Stop button (the `airDrum.enabled` dial, through the
 * single write path), the hand / point / sound / lead / magnetism controls (the same
 * `AirDrumControls` section as the settings editor, so there is exactly one set of
 * controls), and the live readout the settings section deliberately does not carry:
 * whether each hand's floor has been learned, how many hits, and whether the last
 * one was predicted ahead of the strike and by how much — from the engine loop's
 * reporter (`airDrumStatus.ts`).
 */
import { Drum, X } from 'lucide-react';
import { dispatchDialSetIn } from './dispatchDial';
import { AirDrumControls } from './dials/panels/airDrum';
import { useDialsSettings } from './dials/useDialsSettings';
import { useAirDrumStatus, type AirDrumLive } from './airDrumStatus';
import { toolById } from './tools';
import { useTools } from './toolsStore';
import type { AirDrumDialParams } from '@/nodes/music/air_drum';

export const AIR_DRUM_TOOL_ID = 'airDrum';

/** What to tell the player, per state. */
export function describeLive(live: AirDrumLive): string {
  if (!live.enabled) return 'Off. Press Start, then strike down with a hand.';
  if (!live.ready.right && !live.ready.left) return 'Strike once to teach each hand where its drum is.';
  if (live.hits === 0) return 'Ready. Strike.';
  const ms = Math.round(Math.abs(live.lastLead) * 1000);
  const hand = live.lastHand === 'left' ? 'Left' : 'Right';
  return live.lastLead >= 0 ? `${hand}: predicted ${ms} ms before the strike.` : `${hand}: sounded ${ms} ms after the strike (too fast to predict).`;
}

function LiveReadout({ live }: { live: AirDrumLive }) {
  const share = live.hits > 0 ? Math.round((100 * live.predicted) / live.hits) : 0;
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs" data-testid="air-drum-live" data-state={live.enabled ? (live.hits > 0 ? 'playing' : 'ready') : 'off'}>
      <div className="flex items-center justify-between">
        <span className="text-white/80">{describeLive(live)}</span>
        {live.enabled && live.hits > 0 && (
          <span className="font-mono text-emerald-300" title="hits, and the share predicted ahead of the strike">
            {live.hits} · {share}%
          </span>
        )}
      </div>
      {live.enabled && (
        <div className="flex gap-3 text-[10px] text-white/50">
          <span>Right drum: {live.ready.right ? 'learned' : 'strike once'}</span>
          <span>Left drum: {live.ready.left ? 'learned' : 'strike once'}</span>
        </div>
      )}
    </div>
  );
}

export default function AirDrumPanel() {
  const open = useTools((s) => s.open) === AIR_DRUM_TOOL_ID;
  const close = useTools((s) => s.close);
  const { state } = useDialsSettings();
  const live = useAirDrumStatus((s) => s.live);
  if (!open) return null;

  const tool = toolById(AIR_DRUM_TOOL_ID);
  const enabled = ((state.effective.airDrum ?? {}) as Partial<AirDrumDialParams>).enabled === true;

  return (
    <div className="absolute bottom-14 left-3 z-40 flex max-h-[calc(100dvh-5rem)] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Drum className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-white/70">Air drum</span>
        <button onClick={close} aria-label="Close the Air drum" className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 overflow-auto p-4">
        {tool && <p className="text-[10px] uppercase tracking-widest text-emerald-500/70">{tool.description}</p>}
        <button
          onClick={() => void dispatchDialSetIn('airDrum.enabled', !enabled)}
          className={`w-full rounded-lg px-3 py-2 text-sm font-semibold transition ${
            enabled ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-emerald-500 text-black hover:bg-emerald-400'
          }`}
        >
          {enabled ? 'Stop drumming' : 'Start drumming'}
        </button>
        <LiveReadout live={live} />
        <p className="text-[10px] leading-relaxed text-white/50">
          Strike down in front of the camera as if hitting a drum. The first strike of each hand
          teaches the instrument where that drum is; from then on the hit sounds at the strike,
          predicted from the stroke before the camera has even seen it land. Bigger strokes are louder.
        </p>
        <AirDrumControls />
      </div>
    </div>
  );
}
