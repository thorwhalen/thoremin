/**
 * ControlsPanel — schema-light UI bound to the Zustand control store. Changing
 * any value updates the store; the `store-controls` DAG node reads it on the
 * next tick, so edits take effect live without rebuilding the graph.
 *
 * Sections: per-hand voice, master/sync, the composable Overlay elements, and
 * named Presets (save/load/delete via the zodal-backed preset store).
 *
 * Renders just the controls *content* (no outer card); the host (App) wraps it
 * in a collapsible translucent overlay so the video stays the focus.
 */
import { useState } from 'react';
import { NOTES, SCALE_TYPES, type ScaleTypeId } from '@/music/theory';
import { INSTRUMENTS, INSTRUMENT_IDS } from '@/music/instruments';
import { useControls, type VoiceControl } from './store';
import { usePresets } from './usePresets';

const selectCls = 'rounded bg-white/10 px-2 py-1 text-xs outline-none focus:bg-white/20';

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

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

function OverlayControls() {
  const overlay = useControls((s) => s.overlay);
  const set = useControls((s) => s.setOverlayElement);

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70">Overlay</h3>
      <Toggle label="Video backdrop" checked={overlay.video.show} onChange={(v) => set('video', { show: v })} />
      <label className="flex items-center justify-between gap-2 text-xs">
        Background opacity
        <input
          type="range" min={0} max={1} step={0.01} value={overlay.video.alpha}
          onChange={(e) => set('video', { alpha: Number(e.target.value) })}
        />
      </label>
      <Toggle label="Scale guide" checked={overlay.scaleGuide.show} onChange={(v) => set('scaleGuide', { show: v })} />
      <Toggle label="Scale guide labels" checked={overlay.scaleGuide.showLabels} onChange={(v) => set('scaleGuide', { showLabels: v })} />
      <Toggle label="Index-finger guide" checked={overlay.indexGuide.show} onChange={(v) => set('indexGuide', { show: v })} />
      <Toggle label="Index guide dashed" checked={overlay.indexGuide.dashed} onChange={(v) => set('indexGuide', { dashed: v })} />
      <Toggle label="Hand landmarks" checked={overlay.landmarks.show} onChange={(v) => set('landmarks', { show: v })} />
      <Toggle label="Control markers" checked={overlay.markers.show} onChange={(v) => set('markers', { show: v })} />
      <Toggle label="Note names" checked={overlay.markers.showNotes} onChange={(v) => set('markers', { showNotes: v })} />
    </div>
  );
}

function PresetControls() {
  const { presets, busy, save, load, remove } = usePresets();
  const [name, setName] = useState('');

  const doSave = () => {
    void save(name);
    setName('');
  };

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70">Presets</h3>
      <div className="flex gap-1">
        <input
          className={`${selectCls} flex-1`}
          placeholder="Name this setup…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doSave();
          }}
        />
        <button
          type="button"
          className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-40"
          disabled={busy || !name.trim()}
          onClick={doSave}
        >
          Save
        </button>
      </div>
      {presets.length === 0 ? (
        <p className="text-[10px] text-white/40">No saved presets yet.</p>
      ) : (
        <ul className="space-y-1">
          {presets.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                className="flex-1 truncate text-left hover:text-emerald-300"
                title="Load this preset"
                onClick={() => void load(p.id)}
              >
                {p.name}
              </button>
              <button
                type="button"
                className="px-1 text-white/40 hover:text-red-400"
                title="Delete this preset"
                onClick={() => void remove(p.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
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
      <div className="border-t border-white/10 pt-3">
        <OverlayControls />
      </div>
      <div className="border-t border-white/10 pt-3">
        <PresetControls />
      </div>
      <div className="border-t border-white/10 pt-3 text-[10px] leading-relaxed text-white/50">
        <p className="mb-1 font-bold uppercase tracking-widest text-white/70">Keyboard</p>
        <p>↑ / ↓ — octave shift</p>
        <p>← / → — less / more scale-snap</p>
        <p>m — mute</p>
      </div>
    </div>
  );
}
