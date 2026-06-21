/**
 * ControlsPanel — schema-light UI bound to the Zustand control store. Changing
 * any value updates the store; the `store-controls` DAG node reads it on the
 * next tick, so edits take effect live without rebuilding the graph.
 *
 * Renders just the controls *content* (no outer card); the host (App) wraps it
 * in a collapsible translucent overlay so the video stays the focus.
 */
import { NOTES, SCALE_TYPES, type ScaleTypeId } from '@/music/theory';
import { INSTRUMENTS, INSTRUMENT_IDS } from '@/music/instruments';
import { useControls, type VoiceControl } from './store';

const selectCls = 'rounded bg-white/10 px-2 py-1 text-xs outline-none focus:bg-white/20';

function VoiceControls({ side }: { side: 'right' | 'left' }) {
  const voice = useControls((s) => s[side]);
  const setVoice = useControls((s) => s.setVoice);
  const color = side === 'right' ? 'text-emerald-400' : 'text-blue-400';

  return (
    <div className="space-y-2">
      <h3 className={`text-[11px] font-bold uppercase tracking-widest ${color}`}>{side} hand</h3>
      <label className="flex items-center justify-between gap-2 text-xs">
        Instrument
        <select
          className={selectCls}
          value={voice.instrument}
          onChange={(e) => setVoice(side, { instrument: e.target.value as VoiceControl['instrument'] })}
        >
          {INSTRUMENT_IDS.map((id) => (
            <option key={id} value={id}>{INSTRUMENTS[id].name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Root
        <select
          className={selectCls}
          value={voice.root}
          onChange={(e) => setVoice(side, { root: Number(e.target.value) })}
        >
          {NOTES.map((n, i) => (
            <option key={n} value={i}>{n}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Scale
        <select
          className={selectCls}
          value={voice.type}
          onChange={(e) => setVoice(side, { type: e.target.value as ScaleTypeId })}
        >
          {Object.entries(SCALE_TYPES).map(([id, s]) => (
            <option key={id} value={id}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Octaves
        <input
          type="range" min={1} max={4} step={1} value={voice.octaves}
          onChange={(e) => setVoice(side, { octaves: Number(e.target.value) })}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Base octave
        <input
          type="range" min={1} max={5} step={1} value={voice.baseOctave}
          onChange={(e) => setVoice(side, { baseOctave: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}

export default function ControlsPanel() {
  const syncHands = useControls((s) => s.syncHands);
  const setSync = useControls((s) => s.setSync);
  const masterVolume = useControls((s) => s.masterVolume);
  const setMasterVolume = useControls((s) => s.setMasterVolume);

  return (
    <div className="space-y-4">
      <div>
        <label className="flex items-center justify-between gap-2 text-xs">
          Master volume
          <input
            type="range" min={0} max={1} step={0.01} value={masterVolume}
            onChange={(e) => setMasterVolume(Number(e.target.value))}
          />
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={syncHands} onChange={(e) => setSync(e.target.checked)} />
          Sync both hands
        </label>
      </div>
      <VoiceControls side="right" />
      {!syncHands && <VoiceControls side="left" />}
      <div className="border-t border-white/10 pt-3 text-[10px] leading-relaxed text-white/50">
        <p className="mb-1 font-bold uppercase tracking-widest text-white/70">Keyboard</p>
        <p>↑ / ↓ — octave shift</p>
        <p>← / → — less / more scale-snap</p>
        <p>m — mute</p>
      </div>
    </div>
  );
}
