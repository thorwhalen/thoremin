/**
 * The HAND section of the settings panel: the hand→sound mapping — the note SOURCE,
 * the whole-hand knobs, and the per-finger→effect routing.
 */
import { EFFECTS, type HandMap, type FingerTarget } from '@/nodes/mapping/hand_map';
import { FINGER_NAMES } from '@/nodes/domain';
import { useDialsSettings } from '../useDialsSettings';
import { EFFECT_LABELS } from '../labels';
import { CollapsibleSection, Toggle, selectCls } from '../primitives';

/**
 * Hand→sound mapping: the note SOURCE (index fingertip or the steadier wrist), the
 * whole-hand knobs (fist-mute, open-brightness, pinch-vibrato, scale snap), and the
 * per-finger→effect routing (pinch a finger toward the thumb to drive its effect,
 * continuous or as a discrete trigger). Grounded in the hand-control research (#80).
 */
export function HandControls() {
  const { state, set } = useDialsSettings();
  const hm = state.effective['handMap'] as HandMap;
  const patch = (p: Partial<HandMap>) => set('handMap', { ...hm, ...p });
  const patchFinger = (name: (typeof FINGER_NAMES)[number], r: Partial<HandMap['fingers'][string]>) =>
    set('handMap', { ...hm, fingers: { ...hm.fingers, [name]: { ...hm.fingers[name], ...r } } });

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-2 text-xs">
        Note source
        <select
          className={selectCls}
          value={hm.positionSource}
          onChange={(e) => patch({ positionSource: e.target.value as HandMap['positionSource'] })}
        >
          <option value="index">Index finger</option>
          <option value="wrist">Wrist</option>
        </select>
      </label>
      <Toggle label="Closed fist mutes" checked={hm.opennessGatesGain} onChange={(v) => patch({ opennessGatesGain: v })} />
      <Toggle label="Open hand → brighter" checked={hm.opennessControlsBrightness} onChange={(v) => patch({ opennessControlsBrightness: v })} />
      <Toggle label="Pinch → vibrato" checked={hm.pinchControlsVibrato} onChange={(v) => patch({ pinchControlsVibrato: v })} />
      <Toggle label="Position → stereo pan" checked={hm.panByPosition} onChange={(v) => patch({ panByPosition: v })} />
      <label className={`flex items-center justify-between gap-2 text-xs ${hm.panByPosition ? '' : 'opacity-40'}`}>
        Pan spread
        <input
          type="range" min={0} max={1} step={0.01} value={hm.panSpread}
          onChange={(e) => patch({ panSpread: Number(e.target.value) })}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Max volume
        <input
          type="range" min={0} max={1} step={0.01} value={hm.maxGain}
          onChange={(e) => patch({ maxGain: Number(e.target.value) })}
        />
      </label>

      <CollapsibleSection label="Finger effects" defaultOpen={false}>
        <p className="text-[10px] leading-relaxed text-white/40">
          Each finger's distance to the thumb controls an effect — pinch a finger toward the thumb to drive it.
          The index finger is the most controllable; the ring the least.
        </p>
        {FINGER_NAMES.map((name) => {
          const r = hm.fingers[name];
          return (
            <div key={name} className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-12 shrink-0 capitalize">{name}</span>
                <select
                  className={`${selectCls} flex-1`}
                  value={r.target}
                  onChange={(e) => patchFinger(name, { target: e.target.value as FingerTarget })}
                >
                  {(['none', ...EFFECTS] as FingerTarget[]).map((t) => (
                    <option key={t} value={t}>{EFFECT_LABELS[t]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`rounded px-1.5 py-1 text-[9px] uppercase tracking-widest transition ${r.target === 'none' ? 'opacity-30' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                  title={r.mode === 'trigger' ? 'Discrete trigger (pinch to fire)' : 'Continuous'}
                  disabled={r.target === 'none'}
                  onClick={() => patchFinger(name, { mode: r.mode === 'continuous' ? 'trigger' : 'continuous' })}
                >
                  {r.mode === 'trigger' ? 'trig' : 'cont'}
                </button>
                <button
                  type="button"
                  className={`rounded px-1.5 py-1 text-[9px] uppercase tracking-widest transition ${
                    r.target === 'none' ? 'opacity-30' : r.invert ? 'bg-amber-300/20 text-amber-200' : 'bg-white/10 text-white/50 hover:bg-white/20'
                  }`}
                  title={r.invert ? 'Inverted: far from the thumb drives it' : 'Normal: close to the thumb drives it'}
                  disabled={r.target === 'none'}
                  onClick={() => patchFinger(name, { invert: !r.invert })}
                >
                  inv
                </button>
              </div>
              {r.target !== 'none' && (
                <label className="flex items-center justify-between gap-2 pl-12 text-[10px] text-white/60">
                  sensitivity
                  <input
                    type="range" min={0} max={2} step={0.05} value={r.sensitivity}
                    onChange={(e) => patchFinger(name, { sensitivity: Number(e.target.value) })}
                  />
                </label>
              )}
            </div>
          );
        })}
      </CollapsibleSection>
    </div>
  );
}
