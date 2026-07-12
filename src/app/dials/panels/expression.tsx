/**
 * The EXPRESSION-MAPPING section of the settings panel: the per-emotion firing
 * sensitivity, the expression→scale-degree assignment (chord mode), the live chord
 * preview, and the per-device calibration entry point.
 */
import { useState } from 'react';
import { diatonicTriad, defaultChordSpecFor, type ScaleTypeId } from '@/music/theory';
import { voiceTriad, type VoicingId } from '@/music/voicing';
import { EXPRESSIONS, EMOTIONS, DEFAULT_EXPRESSION_TO_DEGREE, SILENCE_DEGREE } from '@/music/expression';
import { useControls } from '../../store';
import { CalibrationWizard } from '../../CalibrationWizard';
import { useDialsSettings } from '../useDialsSettings';
import { CollapsibleSection, selectCls } from '../primitives';

/**
 * Per-expression mapping editor (advanced). The per-emotion SENSITIVITY sliders
 * apply in any active face mode (the classifier runs in timbre mode too — it
 * feeds the readout/status there), so they show whenever a mapping is on. The
 * scale-degree dropdown + live chord MIDI are chord-specific, so they appear only
 * in chord mode (where `neutral` also gets a row — its rest chord). The (global)
 * rendering lives in ChordControls. The two maps are single dial values
 * (`faceExpr.sensitivity` / `faceExpr.degrees`); each edit writes a merged copy.
 */
export function ExpressionMapping({ chordMode }: { chordMode: boolean }) {
  const { state, set } = useDialsSettings();
  const v = state.effective;
  const degrees = v['faceExpr.degrees'] as Record<string, number>;
  const sensitivity = v['faceExpr.sensitivity'] as Record<string, number>;
  const calibration = useControls((s) => s.faceCalibration);
  const setCalibration = useControls((s) => s.setFaceCalibration);
  const [wizardOpen, setWizardOpen] = useState(false);
  const setDegree = (label: string, degree: number) =>
    set('faceExpr.degrees', { ...degrees, [label]: degree });
  const setSens = (label: string, value: number) =>
    set('faceExpr.sensitivity', { ...sensitivity, [label]: value });
  const voicing = v['faceChord.voicing'] as VoicingId;

  // Build the preview chords from the resolved CHORD-SOURCE scale (#75), so the notes
  // shown match what actually sounds — not the melody scale.
  const chordSource = v['faceChord.chordSource'] as 'auto' | 'custom';
  const resolved =
    chordSource === 'custom'
      ? { root: v['faceChord.chordRoot'] as number, type: v['faceChord.chordType'] as ScaleTypeId }
      : defaultChordSpecFor({ root: v['right.root'] as number, type: v['right.type'] as ScaleTypeId });

  const chordMidi = (degree: number): number[] => {
    if (degree < 0) return []; // SILENCE_DEGREE → no chord
    const triad = diatonicTriad(
      {
        root: resolved.root,
        type: resolved.type,
        octaves: v['right.octaves'] as number,
        baseOctave: v['right.baseOctave'] as number,
      },
      degree,
    );
    return triad.length ? voiceTriad(triad, voicing, 0).slice().sort((a, b) => a - b) : [];
  };

  // Chord mode lists all 7 (incl neutral, the rest chord); timbre mode lists only
  // the 6 scored emotions (neutral has no sensitivity / no audio effect there).
  const rows = chordMode ? EXPRESSIONS : EMOTIONS;

  return (
    <CollapsibleSection label={chordMode ? 'Expression mapping' : 'Expression sensitivity'} defaultOpen={false}>
      {wizardOpen && <CalibrationWizard onClose={() => setWizardOpen(false)} />}
      {/* Per-DEVICE calibration: fits each expression's firing bar to what THIS face
          can produce, overriding the sliders below across every instrument. */}
      <div className="flex items-center justify-between rounded-lg bg-white/[0.04] px-2 py-1.5">
        {calibration ? (
          <>
            <span className="text-[10px] text-emerald-400">✓ Calibrated to your face</span>
            <div className="flex gap-1.5">
              <button
                className="rounded px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/10"
                onClick={() => setWizardOpen(true)}
              >
                Recalibrate
              </button>
              <button
                className="rounded px-2 py-0.5 text-[10px] text-white/50 hover:bg-white/10"
                onClick={() => setCalibration(null)}
              >
                Clear
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="text-[10px] text-white/50">Hard to trigger? Fit it to your face.</span>
            <button
              className="rounded bg-emerald-500/90 px-2 py-0.5 text-[10px] font-medium text-black hover:bg-emerald-400"
              onClick={() => setWizardOpen(true)}
            >
              Calibrate
            </button>
          </>
        )}
      </div>
      {calibration && (
        <p className="text-[10px] text-white/35">
          Calibration is active — the sliders below are the per-instrument baseline used when you clear it.
        </p>
      )}
      <p className="text-[10px] leading-relaxed text-white/40">
        {chordMode ? (
          <>
            Per expression: how easily it triggers (sensitivity), the scale degree it plays, and the
            chord’s MIDI notes. <span className="text-white/60">Neutral</span> plays when no
            expression is detected.
          </>
        ) : (
          'How easily each expression triggers (higher = more hits). Tune if a neutral face reads as an emotion, or one won’t fire.'
        )}
      </p>
      <div className="space-y-2">
        {rows.map((label) => {
          const isEmotion = label !== 'neutral';
          const degree = degrees[label] ?? DEFAULT_EXPRESSION_TO_DEGREE[label];
          const midi = chordMode ? chordMidi(degree) : [];
          return (
            <div key={label} className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 capitalize">{label}</span>
                {isEmotion ? (
                  <input
                    type="range" min={0} max={1} step={0.01}
                    value={sensitivity[label] ?? 0.5}
                    title="Sensitivity (higher = more hits)"
                    className="flex-1"
                    onChange={(e) => setSens(label, Number(e.target.value))}
                  />
                ) : (
                  <span className="flex-1 text-[10px] italic text-white/30">rest / fallback</span>
                )}
                {chordMode && (
                  <select
                    className={selectCls}
                    value={degree}
                    title="Which chord this expression plays (or silence)"
                    onChange={(e) => setDegree(label, Number(e.target.value))}
                  >
                    <option value={SILENCE_DEGREE}>Silence</option>
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <option key={d} value={d}>{`Degree ${d + 1}`}</option>
                    ))}
                  </select>
                )}
              </div>
              {chordMode && (
                <div className="pl-16 font-mono text-[10px] text-white/40">
                  {degree < 0 ? 'silence (no chord)' : midi.length ? midi.join(' ') : '—'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
