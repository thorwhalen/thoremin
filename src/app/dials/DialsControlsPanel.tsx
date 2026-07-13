/**
 * DialsControlsPanel — the settings panel's COMPOSITION ROOT: it stacks one
 * {@link TopSection} per domain and owns nothing else. Each section's controls live in
 * its own file under `./panels/`, the generic UI atoms in `./primitives`, the display
 * strings in `./labels` — the seams the panel already had, now made explicit.
 *
 * The panel is rendered FROM the zodal-dials surface ({@link thoreminDials}) instead of
 * straight off the zustand control store: every control reads its value from the dials
 * store ({@link useDialsSettings}). A subscription in {@link settingsStore} mirrors each
 * edit into the synchronous hot `useControls` store the DAG reads each tick, so audio
 * still responds live.
 *
 * Every DISCRETE control (a `<select>`, a toggle, a mode button) WRITES by dispatching a
 * command (`../dispatchDial`) — the registry is the single write path shared with the
 * palette, the hotkeys and the AI (#87, swept in #126). The only sanctioned exception is a
 * `type="range"` slider being dragged: a write per pointer-move frame stays a direct
 * `set(key, value)` for latency (Decision B). `test/dials_write_path.test.ts` enforces
 * exactly that split, so the exception cannot quietly widen.
 *
 * What is NOT dials-driven (kept verbatim, reading its own store): the Keyboard
 * cheat-sheet. Recording is not here at all — its settings moved OUT of the instrument
 * into the transient recording-session sheet (#88, see {@link RecordButton}), since
 * recording config is a tooling preference, not an instrument parameter. (Named saved
 * configs are the "instruments" flow that hosts this panel — see InstrumentsPanel.)
 *
 * Renders just the controls *content* (no outer card); the host (App) wraps it in a
 * collapsible translucent overlay so the video stays the focus.
 */
import { useDialsSettings } from './useDialsSettings';
import { dispatchDialSet } from '../dispatchDial';
import { TopSection } from './primitives';
import { VoiceControls } from './panels/voice';
import { HandControls } from './panels/hand';
import { FaceControls } from './panels/face';
import { OverlayControls } from './panels/overlay';

export default function DialsControlsPanel() {
  const { state, set } = useDialsSettings();
  const v = state.effective;
  const syncHands = v['master.syncHands'] as boolean;

  return (
    <div className="space-y-1">
      {/* Sound — the live-performance knobs, open by default. */}
      <TopSection label="Sound" defaultOpen>
        <label className="flex items-center justify-between gap-2 text-xs">
          Master volume
          <input
            type="range" min={0} max={1} step={0.01} value={v['master.volume'] as number}
            onChange={(e) => set('master.volume', Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={syncHands} onChange={(e) => dispatchDialSet('master.syncHands', e.target.checked)} />
          Sync both hands
        </label>
        <VoiceControls side="right" />
        {!syncHands && <VoiceControls side="left" />}
      </TopSection>

      <TopSection label="Hand">
        <HandControls />
      </TopSection>

      <TopSection label="Face">
        <FaceControls />
      </TopSection>

      <TopSection label="Overlay">
        <OverlayControls />
      </TopSection>

      {/* The Feature Lab is NOT here. It measures the instrument rather than being part
          of it, so it lives in the shell's tools bar with the other tools (#136); putting
          it in this editor is what made it unfindable in the first place. */}

      <TopSection label="Keyboard">
        <div className="text-[10px] leading-relaxed text-white/50">
          <p>↑ / ↓ — octave shift</p>
          <p>← / → — less / more scale-snap</p>
          <p>m — mute</p>
          <p>⌘K / Ctrl-K — command palette (set any dial by name)</p>
        </div>
      </TopSection>
    </div>
  );
}
