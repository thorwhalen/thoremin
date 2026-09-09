/**
 * The CONDUCTOR section of the settings panel (#187): conduct the score with a hand.
 * Off by default; the toggle, the hand and point choosers and the follow-tightness
 * slider all write leaves of the structured `conductor` dial through `dispatchDialSetIn`
 * (the single write path). What the follower is doing right now (ready / running /
 * hold, tempo, confidence) is the graph's business and is read off the overlay and the
 * Conductor tool panel (PR 4), not here: this section is the instrument parameter.
 */
import { dispatchDialSetIn } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { selectCls } from '../primitives';
import { CONDUCTOR_HANDS, CONDUCTOR_POINTS, type ConductorDialParams } from '@/nodes/features/conductor';

const HAND_LABEL: Record<ConductorDialParams['hand'], string> = {
  auto: 'either (prefer right)',
  right: 'right hand',
  left: 'left hand',
};
const POINT_LABEL: Record<ConductorDialParams['point'], string> = {
  wrist: 'wrist (steady)',
  indexTip: 'index fingertip (like a baton)',
};

export function ConductorControls() {
  const { state } = useDialsSettings();
  const c = (state.effective.conductor ?? {}) as Partial<ConductorDialParams>;
  const enabled = c.enabled === true;
  const hand = c.hand ?? 'auto';
  const point = c.point ?? 'wrist';
  const servo = c.servoBeats ?? 1;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => dispatchDialSetIn('conductor.enabled', e.target.checked)}
        />
        Conduct the score
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Beating hand
        <select
          className={selectCls}
          value={hand}
          disabled={!enabled}
          onChange={(e) => dispatchDialSetIn('conductor.hand', e.target.value)}
        >
          {CONDUCTOR_HANDS.map((h) => (
            <option key={h} value={h}>
              {HAND_LABEL[h]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Follow
        <select
          className={selectCls}
          value={point}
          disabled={!enabled}
          onChange={(e) => dispatchDialSetIn('conductor.point', e.target.value)}
        >
          {CONDUCTOR_POINTS.map((p) => (
            <option key={p} value={p}>
              {POINT_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>
          Catch-up <span className="text-white/40">({servo.toFixed(2)} beats)</span>
        </span>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.25}
          value={servo}
          disabled={!enabled}
          onChange={(e) => dispatchDialSetIn('conductor.servoBeats', Number(e.target.value))}
          onPointerUp={(e) => dispatchDialSetIn('conductor.servoBeats', Number((e.target as HTMLInputElement).value))}
        />
      </label>
      <p className="text-[10px] leading-relaxed text-white/40">
        Beat time with your hand: the bottom of each stroke is a beat, stroke size is
        loudness, and the score follows your tempo. Stop beating and it holds. A short
        catch-up follows a conductor closely; a long one forgives a shaky beat.
      </p>
    </div>
  );
}
