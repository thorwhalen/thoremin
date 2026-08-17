/**
 * The FACE section of the settings panel: the face-mapping chooser (off / expression→
 * timbre / expression→chord / head-pose→chord), the live face-model status readout, the
 * disclosure of the mode-specific editors (chord sound, expression mapping, pose moves),
 * and — in `controls` mode — the per-axis TUNING for the head/face control axes (#76).
 *
 * The axis editor exists because those axes shipped (PR #86) with their gains, deadzones
 * and neutral zeros reachable only by editing `face_controls.ts` and rebuilding. That is
 * the #136 rule ("a feature nobody can find is not shipped") applied to a parameter
 * rather than a tool. It also changes what a maintainer has to do about the one thing
 * this repo genuinely cannot verify headlessly: whether a real camera's yaw/pitch/roll
 * signs match the intended felt direction. No fixture can answer that. With the axes on
 * a live-wired dial, the answer costs one click of "Flip" while looking at the camera.
 */
import type { ReactNode } from 'react';
import type { FaceMapping } from '@/nodes';
import { type FaceControlsDialParams } from '@/nodes/features/face_controls';
import { dispatchDialSet, dispatchDialSetIn, dispatchDialReset } from '../../dispatchDial';
import { ExpressionHelpButton } from '../../ExpressionHelpPanel';
import { POSE_MOVES } from '../../poseControlsHelp';
import { useFaceStatus } from '../../faceStatus';
import { useDialsSettings } from '../useDialsSettings';
import { FACE_MODE_OPTIONS, FACE_MODE_HINT } from '../labels';
import { CollapsibleSection, selectCls } from '../primitives';
import { ChordControls } from './chord';
import { ExpressionMapping } from './expression';

/** The three head-pose axes, each with its gain and neutral-zero leaf names. Data, not
 *  markup, so adding an axis to the node's params is a one-line change here. */
const HEAD_AXES = [
  { key: 'yaw', label: 'Turn (yaw)', gain: 'yawGain', zero: 'yawZeroDeg' },
  { key: 'pitch', label: 'Nod (pitch)', gain: 'pitchGain', zero: 'pitchZeroDeg' },
  { key: 'roll', label: 'Tilt (roll)', gain: 'rollGain', zero: 'rollZeroDeg' },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  gain: keyof FaceControlsDialParams;
  zero: keyof FaceControlsDialParams;
}>;

/** The blendshape-driven axes: gain + deadzone. `mouthOpen` gates the chord, so its
 *  deadzone is the difference between "resting face plays" and "nothing ever plays". */
const FACE_AXES = [
  { key: 'mouth', label: 'Jaw open', gain: 'mouthGain', dead: 'mouthDeadzone' },
  { key: 'smile', label: 'Smile / frown', gain: 'smileGain', dead: 'smileDeadzone' },
  { key: 'brow', label: 'Brow raise', gain: 'browGain', dead: 'browDeadzone' },
  { key: 'pucker', label: 'Lip pucker', gain: 'puckerGain', dead: 'puckerDeadzone' },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  gain: keyof FaceControlsDialParams;
  dead: keyof FaceControlsDialParams;
}>;

/** Live face-model status + detected expression, driven by the engine (#65). The
 *  classified emotion `label` is shown only when it actually drives the sound — in
 *  head-pose `controls` mode the emotion is unused, so `showLabel` is false there. */
function FaceStatusReadout({ active, showLabel = true }: { active: boolean; showLabel?: boolean }) {
  const status = useFaceStatus((s) => s.status);
  const label = useFaceStatus((s) => (showLabel ? s.label : ''));

  let dot = 'bg-white/30';
  let text = 'Off';
  if (active) {
    switch (status.phase) {
      case 'loading':
        dot = 'bg-amber-400 animate-pulse';
        text = 'Loading face model…';
        break;
      case 'error':
        dot = 'bg-rose-500';
        text = 'Model failed to load';
        break;
      case 'ready':
        if (status.faceDetected) {
          dot = 'bg-emerald-400';
          text = label ? `Face detected — ${label}` : 'Face detected';
        } else {
          dot = 'bg-sky-400';
          text = 'Ready — no face in frame';
        }
        break;
      default:
        dot = 'bg-white/30';
        text = 'Starting…';
    }
  }
  return (
    <div className="flex items-center gap-2 text-[11px] text-white/70">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
      <span>{text}</span>
    </div>
  );
}

/** The "few easy moves" help for head-pose `controls` mode (#76) — mirrors the
 *  axis→music mapping in the `pose-chord` node so the copy can't drift from the
 *  actual behaviour. */
function PoseMovesHelp() {
  return (
    <ul className="space-y-1 pl-1 text-[10px] leading-relaxed text-white/50">
      {POSE_MOVES.map((m) => (
        <li key={m.move}>
          <span className="text-white/70">{m.move}</span> — {m.effect}
        </li>
      ))}
    </ul>
  );
}

/**
 * Per-axis tuning for the head/face control axes (#76).
 *
 * The write-path split here is the repo rule, not a local choice
 * (`test/dials_write_path.test.ts` enforces it): a continuous `type="range"` drag fires a
 * write per pointer-move frame and stays a direct merged write (**Decision B**), while
 * every DISCRETE control — the Flip buttons, Reset — dispatches a command, so it is
 * equally reachable from the Cmd/Ctrl-K palette, a keybinding and the AI assistant.
 *
 * `faceControls` is a whole-object dial (like `overlay` / `handMap`), so it has no
 * per-dial `set` command; the discrete writes address one scalar LEAF by dotted path and
 * dispatch `dial.setIn`, which does the deep-set and the validation inside the command.
 */
function FaceAxisControls() {
  const { state, set } = useDialsSettings();
  const fc = state.effective['faceControls'] as FaceControlsDialParams;

  /** CONTINUOUS (a slider being dragged) — a direct merged write. Decision B: the ONLY
   *  sanctioned direct writer in this panel. */
  const patchLive = (patch: Partial<FaceControlsDialParams>) => set('faceControls', { ...fc, ...patch });

  /** DISCRETE — through the registry, addressing the leaf by path. */
  const setLeaf = (leaf: keyof FaceControlsDialParams, value: number) =>
    dispatchDialSetIn(`faceControls.${String(leaf)}`, value);

  /** Flip an axis's felt direction by negating its gain. This is the whole point of the
   *  panel: the yaw/pitch/roll SIGN conventions cannot be asserted headlessly, so the
   *  check is "does turning right raise the chord?" — and if not, one click fixes it. */
  const flip = (leaf: keyof FaceControlsDialParams) => setLeaf(leaf, -(fc[leaf] as number));

  /**
   * The chrome of a slider row — label, live value, and a slot for the input.
   *
   * Presentational ONLY, and the input is deliberately NOT inside it: the write-path
   * guard sanctions a direct dials write by the source range of the literal
   * `<input type="range">` element, so wrapping the input in a component would hide the
   * exception from the AST — and, as that guard's own comment says, sanctioning a render
   * helper's body would sanctify the whole panel. Keeping the input at the call site
   * keeps Decision B auditable instead of laundered.
   */
  const Row = ({ label, value, children }: { label: string; value: number; children: ReactNode }) => (
    <label className="flex items-center justify-between gap-2 text-xs" title={`${label}: ${value}`}>
      <span className="text-white/70">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="w-9 text-right tabular-nums text-[10px] text-white/40">{value}</span>
        {children}
      </span>
    </label>
  );

  return (
    <CollapsibleSection label="Control axes" defaultOpen={false}>
      <p className="text-[10px] leading-relaxed text-white/40">
        Tune each axis while the camera runs. If an axis feels backwards, hit <em>Flip</em> — the
        camera's sign convention is the one thing that cannot be checked without a face in frame.
      </p>

      {HEAD_AXES.map((a) => (
        <div key={a.key} className="space-y-1 border-l border-white/10 pl-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-white/70">{a.label}</span>
            <button
              type="button"
              className="rounded bg-white/10 px-2 py-0.5 text-[10px] transition hover:bg-white/20"
              onClick={() => flip(a.gain)}
              title="Reverse this axis (negate its gain)"
            >
              Flip {(fc[a.gain] as number) < 0 ? '(reversed)' : ''}
            </button>
          </div>
          <Row label="Gain" value={fc[a.gain] as number}>
            <input
              type="range"
              min={-3}
              max={3}
              step={0.1}
              value={fc[a.gain] as number}
              onChange={(e) => {
                const v = Number(e.target.value);
                patchLive({ [a.gain]: v } as Partial<FaceControlsDialParams>);
              }}
            />
          </Row>
          <Row label="Neutral (deg)" value={fc[a.zero] as number}>
            <input
              type="range"
              min={-45}
              max={45}
              step={1}
              value={fc[a.zero] as number}
              onChange={(e) => {
                const v = Number(e.target.value);
                patchLive({ [a.zero]: v } as Partial<FaceControlsDialParams>);
              }}
            />
          </Row>
        </div>
      ))}

      <Row label="Head range (deg)" value={fc.headRangeDeg}>
        <input
          type="range"
          min={5}
          max={90}
          step={1}
          value={fc.headRangeDeg}
          onChange={(e) => {
            const v = Number(e.target.value);
            patchLive({ headRangeDeg: v });
          }}
        />
      </Row>
      <Row label="Head deadzone (deg)" value={fc.headDeadzoneDeg}>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={fc.headDeadzoneDeg}
          onChange={(e) => {
            const v = Number(e.target.value);
            patchLive({ headDeadzoneDeg: v });
          }}
        />
      </Row>

      {FACE_AXES.map((a) => (
        <div key={a.key} className="space-y-1 border-l border-white/10 pl-2">
          <div className="text-xs text-white/70">{a.label}</div>
          <Row label="Gain" value={fc[a.gain] as number}>
            <input
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={fc[a.gain] as number}
              onChange={(e) => {
                const v = Number(e.target.value);
                patchLive({ [a.gain]: v } as Partial<FaceControlsDialParams>);
              }}
            />
          </Row>
          <Row label="Deadzone" value={fc[a.dead] as number}>
            <input
              type="range"
              min={0}
              max={0.9}
              step={0.01}
              value={fc[a.dead] as number}
              onChange={(e) => {
                const v = Number(e.target.value);
                patchLive({ [a.dead]: v } as Partial<FaceControlsDialParams>);
              }}
            />
          </Row>
        </div>
      ))}

      <Row label="Smoothing" value={fc.smoothing}>
        <input
          type="range"
          min={0}
          max={0.95}
          step={0.01}
          value={fc.smoothing}
          onChange={(e) => {
            const v = Number(e.target.value);
            patchLive({ smoothing: v });
          }}
        />
      </Row>

      <button
        type="button"
        className="rounded bg-white/10 px-2 py-1 text-[10px] transition hover:bg-white/20"
        onClick={() => dispatchDialReset('faceControls')}
      >
        Reset axes to defaults
      </button>
    </CollapsibleSection>
  );
}

export function FaceControls() {
  const { state } = useDialsSettings();
  const v = state.effective;
  const faceMapping = v['face.mapping'] as FaceMapping;

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-2 text-xs">
        Mapping
        <select
          className={selectCls}
          value={faceMapping}
          onChange={(e) => dispatchDialSet('face.mapping', e.target.value as FaceMapping)}
        >
          {/* Every mode is selectable on any melody scale (#75): chord/controls modes
              draw from a decoupled chord-source scale, so no 7-note requirement remains. */}
          {FACE_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-between gap-2">
        <FaceStatusReadout active={faceMapping !== 'none'} showLabel={faceMapping !== 'controls'} />
        {/* Emotion how-to help is for the expression modes; pose mode has its own moves list. */}
        {faceMapping !== 'none' && faceMapping !== 'controls' && <ExpressionHelpButton />}
      </div>
      <p className="text-[10px] leading-relaxed text-white/40">{FACE_MODE_HINT[faceMapping]}</p>
      {faceMapping === 'controls' && <PoseMovesHelp />}
      {faceMapping === 'controls' && <FaceAxisControls />}
      {/* Both chord instruments (emotion + pose) share the same sound settings. */}
      {(faceMapping === 'chord' || faceMapping === 'controls') && <ChordControls />}
      {/* The per-emotion sensitivity / degree editor applies only to the emotion
          modes, not the head-pose instrument. */}
      {faceMapping !== 'none' && faceMapping !== 'controls' && (
        <ExpressionMapping chordMode={faceMapping === 'chord'} />
      )}
    </div>
  );
}
