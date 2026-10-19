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
 * song is chosen right here, in the section the song slice contributes to this panel (#600
 * S15: `ExtensionUi.toolSections`, which also hears Start and Stop inside the click), so a
 * cold load is four clicks: Conductor, Conduct a recording, Choose a recording, Start conducting.
 *
 * "Conduct with" (#375): hands or body, the `conductor.source` dial. Body composes the
 * pose camera branch and the conductor reads it; from a cold load that is three clicks:
 * Conductor, Conduct with body, Start conducting.
 *
 * "Teach my conducting poses" (#383, an extension's entry point since #465): with the body, the panel opens "Your poses" (an extension's
 * tool, so only when the build ships it) asking for the conductor's default names, `ready`,
 * `fermata`, `cut-off` and `rest`: two clicks from the Conductor to a take in that vocabulary.
 * "Start, hold and cut off with my poses" (#384) then lets those categories replace the body
 * conductor's rules (the `poseCategorizer.transport` dial; the categorizer itself is chosen by
 * "Play it" in Your poses, which the checkbox opens when none is chosen yet).
 *
 * "Dance the orchestra" (#380): the same dial's third leader, a dancer. The pose branch
 * again, read as the dancer's pulse; the score starts on the dancer's step once the
 * rhythm has held for a few seconds. Three clicks: Conductor, Dance the orchestra, Start.
 */
import type { ExtensionToolPanelProps } from '@thoremin/sdk-ui/types';
import { dispatchDialSetIn } from '@thoremin/sdk-ui/dials';
import { ConductorControls } from './conductor';
import ConductorTiming from './ConductorTiming';
import { CONDUCTOR_SOURCES } from '../nodes/conductor.schema';
import { useDialsSettings } from '@thoremin/sdk-ui/dials';
import { useConductorStatus, type ConductorLive } from '../app/conductorStatus';
import type { ConductorSettings } from '../schema';

export const CONDUCTOR_TOOL_ID = 'conductor';
/** The entry point an extension declares for choosing the poses to play (#465): the checkbox below
 *  opens its tool when none is chosen yet. Absent from the build: it opens nothing. */
const POSES_ENTRY_ID = 'conductor-poses';

/** The leader choice's buttons (#375, #380). */
const SOURCE_BUTTON: Record<ConductorSettings['source'], string> = {
  hands: 'Conduct with hands',
  body: 'Conduct with body',
  dancer: 'Dance the orchestra',
};

/** What to tell the player, per follower state (and what they conduct with, #375). */
export function describeLive(live: ConductorLive, source: ConductorSettings['source'] = 'hands', recording = false): string {
  if (source === 'dancer') {
    // Leading a recording, the song's pace law follows the dancer (the Song tool's range).
    if (recording) return live.enabled ? "The song follows your dance (within the Song tool's follow range)." : 'Off. Press Start, then dance: the song follows your steps.';
    if (!live.enabled) return 'Off. Press Start, then dance: the piece starts on your step.';
    switch (live.dance) {
      case 'armed':
        return 'Got your rhythm: the piece starts on your next step.';
      case 'holding':
        return `Holding ${Math.round(live.tempo)} bpm until your rhythm is clear again.`;
      case 'switching':
        return 'Your step changed: following it once it holds.';
      case 'fermata':
        return 'A fermata: holding it for one of your steps.';
      case 'ended':
        return 'The piece is over: dance again and it starts from the top on your step.';
    }
    if (live.state !== 'running') return 'Dance: the piece starts on your step once your rhythm holds for a few seconds.';
    return `Following your dance at ${Math.round(live.tempo)} bpm.`;
  }
  if (!live.enabled) return source === 'body' ? 'Off. Press Start, then beat time with your arm or a bounce.' : 'Off. Press Start, then beat time with your hand.';
  // The body's transport (#377): the pose decides when the piece starts, holds and stops.
  switch (live.transport) {
    case 'idle':
    case 'stopped':
      return 'Raise your beating arm and hold still to get ready.';
    case 'armed':
      return 'Ready. Give an upbeat, and the next beat starts the piece.';
    case 'prepared':
      return 'Upbeat seen: beat the first beat.';
    case 'holding':
      return 'Holding. Beat once to go on, or drop your arm to stop.';
  }
  if (live.state === 'hold') return live.anchors === 0 ? 'Waiting for your first beat.' : 'Holding. Beat once to go on.';
  if (live.state === 'ready') return live.anchors === 0 ? 'Waiting for your first beat.' : 'Finding your tempo...';
  return `Following at ${Math.round(live.tempo)} bpm.`;
}

function LiveReadout({ live, source, recording }: { live: ConductorLive; source: ConductorSettings['source']; recording: boolean }) {
  const beat = live.beatInBar + 1;
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs" data-testid="conductor-live" data-state={live.enabled ? live.state : 'off'}>
      <div className="flex items-center justify-between">
        <span className="text-white/80">{describeLive(live, source, recording)}</span>
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

/** The Conductor tool's panel (#187; an extension tool since #600 S18b): the host draws its frame
 *  and hands it the sections and entry points other contributions bring to it. */
export default function ConductorPanel({ Sections, raise, entryPoints: entryPointsFor, openEntryPoint, openTool }: ExtensionToolPanelProps) {
  const { state } = useDialsSettings();
  const live = useConductorStatus((s) => s.live);

  const conductorDial = (state.effective.conductor ?? {}) as Partial<ConductorSettings>;
  const enabled = conductorDial.enabled === true;
  const recording = conductorDial.conducts === 'recording';
  const source = CONDUCTOR_SOURCES.find((s) => s === conductorDial.source) ?? 'hands';
  const entryPoints = entryPointsFor({ 'conductor.source': source });
  // What the sections other extensions contribute here see (#600 S15), and their `when` may name.
  const sectionContext = { 'conductor.source': source, 'conductor.conducts': conductorDial.conducts ?? 'score', 'conductor.enabled': enabled, live };
  // The faces extension's pose categorizer (#384), when the build ships it: its ready, fermata
  // and cut-off poses may replace the body conductor's rules (#387 B5).
  const poseDial = (state.effective as Record<string, unknown>).poseCategorizer as { id?: string; transport?: boolean } | undefined;
  // The poses add to the body transport's rules (A5), which run only with the rules on and the
  // beating arm read (`conductor.ts`, `TRANSPORT_POINTS`).
  const bodyTransportOn = conductorDial.transport?.rules !== false && ['impact', 'wrist'].includes(String(conductorDial.bodyPoint ?? 'impact'));

  return (
    <div className="space-y-3">
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
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-1 text-xs" role="radiogroup" aria-label="Conduct with">
        {CONDUCTOR_SOURCES.map((value) => (
          <button
            key={value}
            role="radio"
            aria-checked={value === source}
            onClick={() => void dispatchDialSetIn('conductor.source', value)}
            className={`rounded px-2 py-1 font-semibold transition ${value === source ? 'bg-emerald-500 text-black' : 'text-white/70 hover:bg-white/10'}`}
          >
            {SOURCE_BUTTON[value]}
          </button>
        ))}
      </div>
      <Sections context={sectionContext} />
      <button
        onClick={() => {
          // Inside the click (#600 S15): a contributed section may unlock its media here.
          raise(enabled ? 'stop' : 'start', sectionContext);
          void dispatchDialSetIn('conductor.enabled', !enabled);
        }}
        className={`w-full rounded-lg px-3 py-2 text-sm font-semibold transition ${
          enabled ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-emerald-500 text-black hover:bg-emerald-400'
        }`}
      >
        {enabled ? 'Stop conducting' : 'Start conducting'}
      </button>
      {entryPoints.map((e) => (
        <button
          key={e.id}
          data-conductor-entry-point={e.id}
          onClick={() => openEntryPoint(e)}
          className="w-full rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10"
        >
          {e.label}
        </button>
      ))}
      {source === 'body' && poseDial && (
        <label className="flex items-center gap-2 text-xs text-white/80" data-conductor-pose-transport>
          <input
            type="checkbox"
            checked={poseDial.transport === true}
            onChange={(e) => {
              void dispatchDialSetIn('poseCategorizer.transport', e.target.checked);
              // No poses chosen yet: Your poses is where one is played ("Play it").
              const choose = entryPoints.find((x) => x.id === POSES_ENTRY_ID);
              if (e.target.checked && !poseDial.id && choose) openTool(choose.tool);
            }}
          />
          <span>{poseDial.id ? 'Start, hold and cut off with my poses' : 'Start, hold and cut off with my poses (choose them in Your poses)'}</span>
        </label>
      )}
      {source === 'body' && poseDial?.transport && !bodyTransportOn && (
        <p className="text-[10px] text-amber-300/80" data-conductor-pose-transport-off>
          Your poses start and stop the music only while the body transport is on and the conductor reads the beating arm (the conductor section's transport settings).
        </p>
      )}
      {source === 'body' && <ConductorTiming dial={conductorDial} />}
      <LiveReadout live={live} source={source} recording={recording} />
      <p className="text-[10px] leading-relaxed text-white/50">
        {source === 'dancer'
          ? 'Stand back so the camera sees all of you, feet included, and dance. The score finds what your steps repeat at (a beat, a bar), starts on your next step, and follows your tempo within a few percent of its own; your movement sets the loudness. It keeps playing when you stop.'
          : source === 'body'
            ? 'Stand back so the camera sees you from head to hips, and beat time with an arm or bounce with the trunk: the bottom of each bounce is a beat, bigger ones are louder. The score waits for your first stroke, follows your tempo, and holds when you stop.'
            : 'Beat time in front of the camera: the bottom of each stroke is a beat, bigger strokes are louder. The score waits for your first stroke, follows your tempo, and holds when you stop.'}
      </p>
      <ConductorControls sourceChooser={false} />
    </div>
  );
}
