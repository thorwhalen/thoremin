/**
 * The AIR DRUM section of the settings panel (#233): strike the air, hear a drum at
 * the strike. Off by default; the toggle, the hand and point choosers, the two drum
 * sounds and the two sliders all write leaves of the structured `airDrum` dial through
 * `dispatchDialSetIn` (the single write path). The sliders dispatch on every notch
 * (a few steps each), the accepted trade for staying on the write path. What the
 * instrument is doing right now (floors learned, hits, the last hit's lead) is the
 * Air drum tool panel's readout, not this section's.
 */
import { dispatchDialSetIn } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { selectCls } from '../primitives';
import { AIR_DRUM_HANDS, AIR_DRUM_POINTS, DRUM_SOUNDS, type AirDrumDialParams } from '@/nodes/music/air_drum';

const HAND_LABEL: Record<AirDrumDialParams['hand'], string> = {
  both: 'both hands',
  right: 'right hand only',
  left: 'left hand only',
};
const POINT_LABEL: Record<AirDrumDialParams['point'], string> = {
  wrist: 'wrist (steady)',
  indexTip: 'index fingertip (like a stick)',
};
const SOUND_LABEL: Record<AirDrumDialParams['rightSound'], string> = {
  kick: 'kick',
  snare: 'snare',
  hihat: 'hi-hat',
  tom: 'tom',
};

export function AirDrumControls() {
  const { state } = useDialsSettings();
  const c = (state.effective.airDrum ?? {}) as Partial<AirDrumDialParams>;
  const enabled = c.enabled === true;
  const hand = c.hand ?? 'both';
  const point = c.point ?? 'wrist';
  const rightSound = c.rightSound ?? 'kick';
  const leftSound = c.leftSound ?? 'snare';
  const minLead = c.minLead ?? 0.05;
  const magnetism = c.magnetism ?? 0;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => dispatchDialSetIn('airDrum.enabled', e.target.checked)} />
        Drum in the air
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Drumming hands
        <select className={selectCls} value={hand} disabled={!enabled} onChange={(e) => dispatchDialSetIn('airDrum.hand', e.target.value)}>
          {AIR_DRUM_HANDS.map((h) => (
            <option key={h} value={h}>
              {HAND_LABEL[h]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Stick point
        <select className={selectCls} value={point} disabled={!enabled} onChange={(e) => dispatchDialSetIn('airDrum.point', e.target.value)}>
          {AIR_DRUM_POINTS.map((pt) => (
            <option key={pt} value={pt}>
              {POINT_LABEL[pt]}
            </option>
          ))}
        </select>
      </label>
      {(['right', 'left'] as const).map((side) => (
        <label key={side} className="flex items-center justify-between gap-2 text-xs">
          {side === 'right' ? 'Right hand plays' : 'Left hand plays'}
          <select
            className={selectCls}
            value={side === 'right' ? rightSound : leftSound}
            disabled={!enabled}
            onChange={(e) => dispatchDialSetIn(side === 'right' ? 'airDrum.rightSound' : 'airDrum.leftSound', e.target.value)}
          >
            {DRUM_SOUNDS.map((s) => (
              <option key={s} value={s}>
                {SOUND_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="flex items-center justify-between gap-2 text-xs" title="How far ahead a hit is committed: your audio latency plus a frame. Too late and the hit sounds a frame after the strike.">
        <span>Lead ({Math.round(minLead * 1000)} ms)</span>
        <input
          type="range"
          min={0}
          max={0.15}
          step={0.01}
          value={minLead}
          disabled={!enabled}
          className="w-[55%]"
          onChange={(e) => dispatchDialSetIn('airDrum.minLead', Number(e.target.value))}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="With the conductor on: how far a hit is pulled toward the expected beat (0 = exactly when you struck, 1 = onto the beat).">
        <span>Timing magnetism ({magnetism.toFixed(1)})</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={magnetism}
          disabled={!enabled}
          className="w-[55%]"
          onChange={(e) => dispatchDialSetIn('airDrum.magnetism', Number(e.target.value))}
        />
      </label>
    </div>
  );
}
