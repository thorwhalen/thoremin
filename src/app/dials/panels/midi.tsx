/**
 * The MIDI section of the settings panel (#137): the on/off dial, a port selector
 * rendered from the device list the `midi-out` node reports (via
 * {@link useMidiStatus} — a connect-time snapshot: the node enumerates ports when
 * it opens, so a device plugged in later appears after toggling MIDI off and on),
 * and an honest connection readout. Where Web MIDI is unavailable (Safari/iOS) the
 * control says so instead of showing a dead toggle; a blocked permission surfaces
 * as its own `denied` phase with a re-allow hint rather than a generic error.
 */
import { dispatchDialSet } from '../../dispatchDial';
import { useMidiStatus } from '../../midiStatus';
import { useDialsSettings } from '../useDialsSettings';
import { selectCls } from '../primitives';
import { webMidiSupported, type MidiPhase } from '@/nodes/output/midi_out';

/** Status-dot color + whether it pulses, per connection phase. */
const PHASE_DOT: Record<MidiPhase, string> = {
  off: 'bg-white/30',
  unsupported: 'bg-rose-500',
  connecting: 'bg-amber-400 animate-pulse',
  ready: 'bg-emerald-400',
  'no-ports': 'bg-amber-400',
  denied: 'bg-rose-500',
  error: 'bg-rose-500',
};

/** Live connection phase + message from the `midi-out` node (it reports; we render). */
function MidiStatusReadout({ enabled }: { enabled: boolean }) {
  const status = useMidiStatus((s) => s.status);
  const dot = enabled ? PHASE_DOT[status.phase] : 'bg-white/30';
  const notes = status.phase === 'ready' && status.activeNotes > 0 ? ` — ${status.activeNotes} note${status.activeNotes > 1 ? 's' : ''}` : '';
  return (
    <div className="flex items-center gap-2 text-[11px] text-white/70">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
      <span>{enabled ? `${status.message}${notes}` : 'MIDI output off'}</span>
    </div>
  );
}

export function MidiControls() {
  const { state } = useDialsSettings();
  const v = state.effective;
  const enabled = v['midi.enabled'] as boolean;
  const port = (v['midi.port'] as string) ?? '';
  const ports = useMidiStatus((s) => s.status.ports);
  const supported = webMidiSupported();

  if (!supported) {
    // Honest gating (#137): no dead toggle where the capability doesn't exist.
    return (
      <p className="text-[10px] leading-relaxed text-white/40">
        Web MIDI is not supported in this browser — use Chrome or Edge to send the
        played voices to an external synth or DAW (Safari and iOS have no Web MIDI).
      </p>
    );
  }

  // The saved port may not exist on THIS machine — keep it selectable (and labeled)
  // rather than silently snapping the dial to another device. De-duplicated because
  // Web MIDI permits two devices with the SAME name (ports are unique by id, not
  // name) and ports are addressed by name end to end here — a deliberate trade-off
  // that keeps `midi.port` a portable preset field; the first same-named device wins.
  const knownPorts = Array.from(new Set(ports.includes(port) || port === '' ? ports : [port, ...ports]));

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => dispatchDialSet('midi.enabled', e.target.checked)}
        />
        Send to MIDI output
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Port
        <select
          className={selectCls}
          value={port}
          disabled={!enabled}
          onChange={(e) => dispatchDialSet('midi.port', e.target.value)}
        >
          <option value="">First available</option>
          {knownPorts.map((p) => (
            <option key={p} value={p}>
              {ports.includes(p) ? p : `${p} (not found)`}
            </option>
          ))}
        </select>
      </label>
      <MidiStatusReadout enabled={enabled} />
      <p className="text-[10px] leading-relaxed text-white/40">
        Plays the same notes your hands (and face chords) play on an external
        hardware/software instrument — pick it as a MIDI input in your DAW.
      </p>
    </div>
  );
}
