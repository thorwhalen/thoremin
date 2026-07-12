/**
 * The FACE section of the settings panel: the face-mapping chooser (off / expression→
 * timbre / expression→chord / head-pose→chord), the live face-model status readout, and
 * the disclosure of the mode-specific editors (chord sound, expression mapping, pose moves).
 */
import type { FaceMapping } from '@/nodes';
import { dispatchDialSet } from '../../dispatchDial';
import { ExpressionHelpButton } from '../../ExpressionHelpPanel';
import { POSE_MOVES } from '../../poseControlsHelp';
import { useFaceStatus } from '../../faceStatus';
import { useDialsSettings } from '../useDialsSettings';
import { FACE_MODE_OPTIONS, FACE_MODE_HINT } from '../labels';
import { selectCls } from '../primitives';
import { ChordControls } from './chord';
import { ExpressionMapping } from './expression';

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
