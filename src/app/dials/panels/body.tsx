/**
 * The BODY section of the settings panel (#186): the body-tracking on/off dial and
 * the PoseLandmarker model choice. Body tracking is the most expensive model the
 * graph can host, so it is a dial the player turns on — never a default — and the
 * copy says what it costs. Both controls dispatch commands (the single write path).
 */
import { dispatchDialSet } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { selectCls } from '../primitives';
import { BODY_MODELS } from '@/settings/schema';

const MODEL_LABEL: Record<(typeof BODY_MODELS)[number], string> = {
  lite: 'lite (fast, 6 MB)',
  full: 'full (steadier, 9 MB)',
};

export function BodyControls() {
  const { state } = useDialsSettings();
  const v = state.effective;
  const enabled = v['body.enabled'] as boolean;
  const model = (v['body.model'] as (typeof BODY_MODELS)[number]) ?? 'lite';

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => dispatchDialSet('body.enabled', e.target.checked)}
        />
        Track the body
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Model
        <select
          className={selectCls}
          value={model}
          disabled={!enabled}
          onChange={(e) => dispatchDialSet('body.model', e.target.value)}
        >
          {BODY_MODELS.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[10px] leading-relaxed text-white/40">
        Detects 33 full-body landmarks from the webcam and draws the skeleton on the
        video. It is the source for body features (the Lab, the trainer) and the dance
        pulse; the model downloads on first use.
      </p>
    </div>
  );
}
