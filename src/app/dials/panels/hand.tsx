/**
 * The HAND section of the settings panel: the hand→sound mapping — the note SOURCE,
 * the whole-hand knobs, and the per-finger→effect routing.
 */
import { EFFECTS, type HandMap, type FingerRoute, type FingerTarget } from '@/nodes/mapping/hand_map';
import { FINGER_NAMES } from '@thoremin/sdk/nodes/domain';
import { dispatchDialSet, dispatchDialSetIn } from '../../dispatchDial';
import { DEFAULT_HANDEDNESS_DWELL_FRAMES } from '@thoremin/sdk/features/handedness';
import { useDialsSettings } from '../useDialsSettings';
import { EFFECT_LABELS } from '../labels';
import { CollapsibleSection, Toggle, selectCls } from '@thoremin/sdk-ui/primitives';

/** A finger route's fields, as addressable leaf names under `handMap.fingers.<name>`. */
type FingerField = keyof FingerRoute;

/** The handedness dwell choices (#148): off, and a few frame counts around the measured
 *  1-2 frame flicker. A dwell of N holds a new label for N frames, so it absorbs a flicker
 *  of up to N frames and delays a real hand swap by exactly N frames: the label says what
 *  that costs at 30 fps. */
const HANDEDNESS_DWELL_CHOICES: ReadonlyArray<{ frames: number; label: string }> = [
  { frames: DEFAULT_HANDEDNESS_DWELL_FRAMES, label: 'Off (follow the label at once)' },
  { frames: 2, label: '2 frames (swap delayed ~67 ms)' },
  { frames: 3, label: '3 frames (swap delayed ~100 ms)' },
  { frames: 5, label: '5 frames (swap delayed ~167 ms)' },
  { frames: 8, label: '8 frames (swap delayed ~267 ms)' },
];

/**
 * Hand→sound mapping: the note SOURCE (index fingertip or the steadier wrist), the
 * whole-hand knobs (fist-mute, open-brightness, pinch-vibrato, scale snap), and the
 * per-finger→effect routing (pinch a finger toward the thumb to drive its effect,
 * continuous or as a discrete trigger). Grounded in the hand-control research (#80).
 *
 * `handMap` is a whole-object dial, so it has no per-dial `set` command. Its discrete
 * controls address one scalar LEAF by path (`handMap.fingers.index.target`) and dispatch
 * `dial.setIn` — the deep-set + validation happen inside the command, so the panel never
 * hand-rolls a merged copy. The sliders keep a direct merged write (Decision B).
 *
 * The handedness dwell (#148) is a SCALAR dial (`hands.handednessDwell`), so its select
 * dispatches `dial.hands.handednessDwell.set` through `dispatchDialSet`. Three clicks from
 * a cold load: Settings, the Hand section, the select.
 */
export function HandControls() {
  const { state, set } = useDialsSettings();
  const hm = state.effective['handMap'] as HandMap;
  const handednessDwell = state.effective['hands.handednessDwell'] as number;
  // A value a saved instrument set that is not one of the shortlist still shows as itself.
  const dwellChoices = HANDEDNESS_DWELL_CHOICES.some((c) => c.frames === handednessDwell)
    ? HANDEDNESS_DWELL_CHOICES
    : [...HANDEDNESS_DWELL_CHOICES, { frames: handednessDwell, label: `${handednessDwell} frames` }].sort((a, b) => a.frames - b.frames);

  /** A DISCRETE whole-hand edit (a select / toggle) — through the registry, by path. */
  const setField = (field: keyof HandMap, value: unknown) => dispatchDialSetIn(`handMap.${field}`, value);
  /** A DISCRETE per-finger edit (the target select, the mode/invert buttons). */
  const setFinger = (name: (typeof FINGER_NAMES)[number], field: FingerField, value: unknown) =>
    dispatchDialSetIn(`handMap.fingers.${name}.${field}`, value);

  /** A CONTINUOUS edit (a slider being dragged) — a direct merged write. Decision B: a
   *  write per pointer-move frame must not pay for dispatch. These two are the ONLY
   *  sanctioned direct writers in this panel. */
  const patchLive = (p: Partial<HandMap>) => set('handMap', { ...hm, ...p });
  const patchFingerLive = (name: (typeof FINGER_NAMES)[number], r: Partial<FingerRoute>) =>
    set('handMap', { ...hm, fingers: { ...hm.fingers, [name]: { ...hm.fingers[name], ...r } } });

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-2 text-xs">
        Note source
        <select
          className={selectCls}
          value={hm.positionSource}
          onChange={(e) => setField('positionSource', e.target.value)}
        >
          <option value="index">Index finger</option>
          <option value="wrist">Wrist</option>
        </select>
      </label>
      <Toggle label="Closed fist mutes" checked={hm.opennessGatesGain} onChange={(v) => setField('opennessGatesGain', v)} />
      <Toggle label="Open hand → brighter" checked={hm.opennessControlsBrightness} onChange={(v) => setField('opennessControlsBrightness', v)} />
      <Toggle label="Pinch → vibrato" checked={hm.pinchControlsVibrato} onChange={(v) => setField('pinchControlsVibrato', v)} />
      <Toggle label="Position → stereo pan" checked={hm.panByPosition} onChange={(v) => setField('panByPosition', v)} />
      <label className={`flex items-center justify-between gap-2 text-xs ${hm.panByPosition ? '' : 'opacity-40'}`}>
        Pan spread
        <input
          type="range" min={0} max={1} step={0.01} value={hm.panSpread}
          onChange={(e) => patchLive({ panSpread: Number(e.target.value) })}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Max volume
        <input
          type="range" min={0} max={1} step={0.01} value={hm.maxGain}
          onChange={(e) => patchLive({ maxGain: Number(e.target.value) })}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="Field instruments only (the air instruments label hands themselves). The camera sometimes relabels a turning hand Left/Right for a frame or two; a dwell of N frames holds the voice on its side through any relabel of up to N frames, and delays a real hand swap by exactly N frames.">
        Handedness dwell
        <select
          className={selectCls}
          aria-label="Handedness dwell"
          value={handednessDwell}
          onChange={(e) => dispatchDialSet('hands.handednessDwell', Number(e.target.value))}
        >
          {dwellChoices.map((c) => (
            <option key={c.frames} value={c.frames}>{c.label}</option>
          ))}
        </select>
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
                  onChange={(e) => setFinger(name, 'target', e.target.value)}
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
                  onClick={() => setFinger(name, 'mode', r.mode === 'continuous' ? 'trigger' : 'continuous')}
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
                  onClick={() => setFinger(name, 'invert', !r.invert)}
                >
                  inv
                </button>
              </div>
              {r.target !== 'none' && (
                <label className="flex items-center justify-between gap-2 pl-12 text-[10px] text-white/60">
                  sensitivity
                  <input
                    type="range" min={0} max={2} step={0.05} value={r.sensitivity}
                    onChange={(e) => patchFingerLive(name, { sensitivity: Number(e.target.value) })}
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
