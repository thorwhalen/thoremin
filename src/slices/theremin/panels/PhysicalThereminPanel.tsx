/**
 * The physical theremin's editor section: the switch and what it is doing, the assistance (one
 * level and, under it, its four stages, each tunable: tuning one makes the stages the player's
 * own, `assist.custom`), the sound, and the antennas and circuits for a player who wants to
 * calibrate it like a real instrument.
 */
import { dispatchDialSet, dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import { CollapsibleSection, ValueRow, selectCls } from '@thoremin/sdk-ui/primitives';
import { SOUND_IDS, SOUNDS } from '@thoremin/sdk/music/sounds';
import { DEFAULT_PHYSICAL_THEREMIN, LEFT_ABSENT, type PhysicalThereminSettings } from '../schema';
import { SNAP_SCALES, assistDefaults, effectiveAssist, type AssistSettings } from '../lib/assist';
import { describeThereminLive, usePhysicalThereminStatus } from '../app/status';

const KEY = 'physicalTheremin';

const SNAP_LABEL: Record<(typeof SNAP_SCALES)[number], string> = { chromatic: 'every semitone', scale: "the instrument's scale" };
const LEFT_LABEL: Record<(typeof LEFT_ABSENT)[number], string> = { full: 'full volume', silent: 'silence' };

export function PhysicalThereminReadout() {
  const live = usePhysicalThereminStatus((s) => s.live);
  return <div className="text-xs text-white/80">{describeThereminLive(live)}</div>;
}

/** The dial with one assistance stage changed: the stages become the player's own, starting
 *  from what the level gave them. */
export function withStage(c: PhysicalThereminSettings, stage: keyof ReturnType<typeof assistDefaults>, value: unknown): PhysicalThereminSettings {
  const base: AssistSettings = c.assist.custom ? c.assist : { ...c.assist, ...assistDefaults(c.assist.level), custom: true };
  return { ...c, assist: { ...base, [stage]: value, custom: true } };
}

function Slider({ label, value, min, max, step, disabled, onChange, shown }: { label: string; value: number; min: number; max: number; step: number; disabled?: boolean; onChange: (v: number) => void; shown?: number }) {
  return (
    <ValueRow label={label} value={shown ?? value}>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} className="w-28" onChange={(e) => onChange(Number(e.target.value))} />
    </ValueRow>
  );
}

export function PhysicalThereminControls() {
  const { state } = useDialsSettings();
  const raw = (state.effective[KEY] ?? {}) as Partial<PhysicalThereminSettings>;
  const c: PhysicalThereminSettings = { ...DEFAULT_PHYSICAL_THEREMIN, ...raw } as PhysicalThereminSettings;
  const enabled = c.enabled === true;
  const stages = effectiveAssist(c.assist);
  const pure = !(c.assist.level > 0);
  const setStage = (stage: keyof ReturnType<typeof assistDefaults>, value: unknown) => dispatchDialSet(KEY, withStage(c, stage, value));
  return (
    <div className="space-y-2">
      <PhysicalThereminReadout />
      <p className="text-[10px] leading-relaxed text-white/50">
        A theremin through its physics. Your right hand and the rod on the right are the two plates of a capacitor: come closer and the pitch rises, faster and faster near the rod. Opening a finger adds its area to the plate, so it raises the pitch too: hold the hand still and play intervals with the fingers (aerial fingering). Your left hand over the loop sets the volume: lower is quieter, on the loop is silence.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => dispatchDialSetIn(`${KEY}.enabled`, e.target.checked)} />
        Play the physical theremin
      </label>
      <Slider label={pure ? 'Assistance (pure theremin)' : 'Assistance'} value={c.assist.level} min={0} max={1} step={0.05} disabled={!enabled} onChange={(v) => dispatchDialSetIn(`${KEY}.assist.level`, v)} />
      <div className={`space-y-1 pl-2 ${pure ? 'opacity-40' : ''}`}>
        <label className="flex items-center justify-between gap-2 text-xs">
          Pull toward
          <select className={selectCls} value={stages.snap} disabled={!enabled || pure} onChange={(e) => setStage('snap', e.target.value)}>
            {SNAP_SCALES.map((s) => (
              <option key={s} value={s}>
                {SNAP_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <Slider label="Pitch correction" value={stages.correction} min={0} max={1} step={0.05} disabled={!enabled || pure} onChange={(v) => setStage('correction', v)} />
        <Slider label="Smoothing" value={stages.smoothing} min={0} max={1} step={0.05} disabled={!enabled || pure} onChange={(v) => setStage('smoothing', v)} />
        <Slider label="Vibrato aid" value={stages.vibratoAid} min={0} max={1} step={0.05} disabled={!enabled || pure} onChange={(v) => setStage('vibratoAid', v)} />
        {c.assist.custom && !pure && (
          <button type="button" className="text-[10px] text-white/50 underline" onClick={() => dispatchDialSetIn(`${KEY}.assist.custom`, false)}>
            Back to the level's defaults
          </button>
        )}
      </div>
      <label className="flex items-center justify-between gap-2 text-xs">
        Sound
        <select className={selectCls} value={c.sound} disabled={!enabled} onChange={(e) => dispatchDialSetIn(`${KEY}.sound`, e.target.value)}>
          {SOUND_IDS.map((id) => (
            <option key={id} value={id}>
              {SOUNDS[id].name}
            </option>
          ))}
        </select>
      </label>
      <Slider label="Volume" value={c.volume} min={0} max={1} step={0.05} disabled={!enabled} onChange={(v) => dispatchDialSetIn(`${KEY}.volume`, v)} />
      <CollapsibleSection label="Antennas and circuits" defaultOpen={false}>
        <Slider label="Linearity" value={c.pitch.linearity} min={0} max={1} step={0.05} disabled={!enabled} onChange={(v) => dispatchDialSetIn(`${KEY}.pitch.linearity`, v)} />
        <Slider label="Pitch sensitivity" value={c.pitch.sensitivity} min={0.2} max={4} step={0.1} disabled={!enabled} onChange={(v) => dispatchDialSetIn(`${KEY}.pitch.sensitivity`, v)} />
        <Slider label="Zero beat (Hz)" value={c.pitch.nullHz} min={0} max={200} step={5} disabled={!enabled} onChange={(v) => dispatchDialSetIn(`${KEY}.pitch.nullHz`, v)} />
        <Slider label="Pitch tank (pF)" value={c.pitch.tankPf} min={30} max={400} step={10} disabled={!enabled} onChange={(v) => dispatchDialSetIn(`${KEY}.pitch.tankPf`, v)} />
        <Slider label="Closest approach (cm)" value={c.pitch.standoffCm} min={0.5} max={10} step={0.5} disabled={!enabled} onChange={(v) => dispatchDialSetIn(`${KEY}.pitch.standoffCm`, v)} />
        <Slider label="Pitch rod across" value={c.pitchAntenna.x} min={0.5} max={1} step={0.01} disabled={!enabled} onChange={(v) => dispatchDialSetIn(`${KEY}.pitchAntenna.x`, v)} />
        <Slider label="Volume loop height" value={c.volumeLoop.y} min={0.5} max={1} step={0.01} disabled={!enabled} onChange={(v) => dispatchDialSetIn(`${KEY}.volumeLoop.y`, v)} />
        <Slider label="Volume sharpness (Q)" value={c.loop.q} min={20} max={500} step={10} disabled={!enabled} onChange={(v) => dispatchDialSetIn(`${KEY}.loop.q`, v)} />
        <label className="flex items-center justify-between gap-2 text-xs">
          Left hand out of view
          <select className={selectCls} value={c.loop.leftAbsent} disabled={!enabled} onChange={(e) => dispatchDialSetIn(`${KEY}.loop.leftAbsent`, e.target.value)}>
            {LEFT_ABSENT.map((s) => (
              <option key={s} value={s}>
                {LEFT_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={c.antennasOnVideo.show} disabled={!enabled} onChange={(e) => dispatchDialSetIn(`${KEY}.antennasOnVideo.show`, e.target.checked)} />
          Antennas on the video
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={c.readout.show} disabled={!enabled} onChange={(e) => dispatchDialSetIn(`${KEY}.readout.show`, e.target.checked)} />
          Note and hertz beside the rod
        </label>
      </CollapsibleSection>
    </div>
  );
}
