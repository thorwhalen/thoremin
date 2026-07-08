/**
 * DialsControlsPanel — the settings panel, rendered FROM the zodal-dials surface
 * ({@link thoreminDials}) instead of straight off the zustand control store. Visually
 * identical to the old hand-wired panel: the same sections, widgets, and conditional
 * disclosure — but every control now reads its value from the dials store
 * ({@link useDialsSettings}) and writes back with `set(key, value)`. A subscription in
 * {@link settingsStore} mirrors each edit into the synchronous hot `useControls` store
 * the DAG reads each tick, so audio still responds live.
 *
 * What is dials-driven: master volume / sync, both voices, the face-mapping chooser +
 * chord sound, the expression-mapping table, and the overlay element config. What is
 * NOT (kept verbatim, reading their own stores): Recording formats (a tooling pref) and
 * the Keyboard cheat-sheet. (Named saved configs are now the "instruments" flow that
 * hosts this panel — see InstrumentsPanel — so the old Presets section was removed.)
 *
 * Renders just the controls *content* (no outer card); the host (App) wraps it in a
 * collapsible translucent overlay so the video stays the focus.
 */
import { useState, type ReactNode } from 'react';
import { NOTES, SCALE_TYPES, isSevenNoteScale, diatonicTriad, type ScaleTypeId } from '@/music/theory';
import { SOUNDS, SOUND_IDS } from '@/music/sounds';
import { VOICINGS, RENDERINGS, isTempoRendering, voiceTriad, type VoicingId, type RenderingId } from '@/music/voicing';
import { EXPRESSIONS, EMOTIONS, DEFAULT_EXPRESSION_TO_DEGREE, SILENCE_DEGREE } from '@/music/expression';
import { OVERLAY_ELEMENTS, OVERLAY_CATEGORIES, type OverlayParams } from '@/nodes/output/canvas_overlay';
import type { FaceMapping } from '@/nodes';
import { useControls } from '../store';
import { dispatchDialSet } from '../dispatchDial';
import { OVERLAY_CONTROLS, type OverlayControlDesc } from '../overlayControls';
import { ExpressionHelpButton } from '../ExpressionHelpPanel';
import { POSE_MOVES } from '../poseControlsHelp';
import { CalibrationWizard } from '../CalibrationWizard';
import { useFaceStatus } from '../faceStatus';
import { RECORDING_FORMATS } from '../recording/formats';
import { EFFECTS, type HandMap, type FingerTarget } from '@/nodes/mapping/hand_map';
import { FINGER_NAMES } from '@/nodes/domain';
import { useDialsSettings } from './useDialsSettings';
import { voiceEditWrites, type VoiceField } from './settingsStore';

const selectCls = 'rounded bg-white/10 px-2 py-1 text-xs outline-none focus:bg-white/20';

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 text-xs ${disabled ? 'opacity-40' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** A collapsible settings group (native <details>), used to group the overlay
 * elements by their category (Input features / Output features / Guides / …). */
function CollapsibleSection({
  label,
  defaultOpen = true,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen}>
      <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-white/60 transition hover:text-white/90">
        {label}
      </summary>
      <div className="mt-2 space-y-2 pl-1">{children}</div>
    </details>
  );
}

/**
 * A top-level collapsible group (Sound / Face / Overlay / …) — the accordion that
 * keeps the panel from overwhelming as settings grow. More prominent than the
 * inner {@link CollapsibleSection}; a ▸/▾ marker and a divider above.
 */
function TopSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group border-t border-white/10 pt-3 [&[open]>summary>span.mk]:rotate-90">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/70 transition hover:text-white">
        <span className="mk inline-block transition-transform">▸</span>
        {label}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

/**
 * One hand's voice (sound / root / scale / octaves / base octave), read from and
 * written to the dials store. Mirrors `setVoice`: when both hands are synced, a
 * non-sound edit on this hand also writes the other hand, so the two voices share
 * scale/root/octaves while each keeps its own sound.
 */
function VoiceControls({ side }: { side: 'right' | 'left' }) {
  const { state, set } = useDialsSettings();
  const v = state.effective;
  const syncHands = v['master.syncHands'] as boolean;
  const color = side === 'right' ? 'text-emerald-400' : 'text-blue-400';

  const setField = (key: VoiceField, value: unknown) => {
    // Reproduce setVoice's sync-hands rule (mirror the whole non-sound voice when
    // synced, keep each hand's own sound); voiceEditWrites yields the dials writes.
    for (const [k, val] of voiceEditWrites(side, key, value, syncHands, v)) set(k, val);
  };

  return (
    <div className="space-y-2">
      <h3 className={`text-[11px] font-bold uppercase tracking-widest ${color}`}>{side} hand</h3>
      <label className="flex items-center justify-between gap-2 text-xs">
        Sound
        <select
          className={selectCls}
          value={v[`${side}.sound`] as string}
          onChange={(e) => setField('sound', e.target.value)}
        >
          {SOUND_IDS.map((id) => (
            <option key={id} value={id}>{SOUNDS[id].name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Root
        <select
          className={selectCls}
          value={v[`${side}.root`] as number}
          onChange={(e) => setField('root', Number(e.target.value))}
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
          value={v[`${side}.type`] as string}
          onChange={(e) => setField('type', e.target.value as ScaleTypeId)}
        >
          {Object.entries(SCALE_TYPES).map(([id, s]) => (
            <option key={id} value={id}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Octaves
        <input
          type="range" min={1} max={4} step={1} value={v[`${side}.octaves`] as number}
          onChange={(e) => setField('octaves', Number(e.target.value))}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Base octave
        <input
          type="range" min={1} max={5} step={1} value={v[`${side}.baseOctave`] as number}
          onChange={(e) => setField('baseOctave', Number(e.target.value))}
        />
      </label>
    </div>
  );
}

/**
 * Overlay settings, DATA-DRIVEN by the element categories: a collapsible section
 * per {@link OVERLAY_CATEGORIES} entry (Input features / Output features / Guides /
 * Backdrop — the "target space of the mapping" framing), and within each, one
 * control per element whose {@link OVERLAY_ELEMENTS}.category matches, rendered
 * from its {@link OVERLAY_CONTROLS} descriptor. Adding an overlay element makes it
 * appear here automatically (a test enforces every element has a descriptor), so
 * this is a general framework, not a hand-maintained list. The whole overlay object
 * is one dial value; each edit writes a merged copy back.
 */
function OverlayControls() {
  const { state, set } = useDialsSettings();
  const overlay = state.effective['overlay'] as OverlayParams;
  const faceActive = state.effective['face.mapping'] !== 'none';
  const categoryOf = new Map(OVERLAY_ELEMENTS.map((e) => [e.name, e.category]));
  const patch = (name: keyof OverlayParams, p: object) =>
    set('overlay', { ...overlay, [name]: { ...(overlay[name] as object), ...p } });

  const renderControl = (d: OverlayControlDesc) => {
    const elt = overlay[d.name] as { show: boolean } & Record<string, unknown>;
    const off = !!d.needsFace && !faceActive;
    return (
      <div key={d.name} className="space-y-1.5">
        <Toggle label={d.label} checked={elt.show} onChange={(v) => patch(d.name, { show: v })} disabled={off} />
        {off && (
          <p className="pl-5 text-[10px] leading-relaxed text-white/30">Appears once a face mapping is on.</p>
        )}
        {d.toggles?.map((t) => (
          <div key={t.key} className="pl-5">
            <Toggle
              label={t.label}
              checked={elt[t.key] as boolean}
              onChange={(v) => patch(d.name, { [t.key]: v })}
              disabled={off || !elt.show}
            />
          </div>
        ))}
        {d.slider && (
          <label className={`flex items-center justify-between gap-2 pl-5 text-xs ${elt.show ? '' : 'opacity-40'}`}>
            {d.slider.label}
            <input
              type="range" min={0} max={1} step={0.01}
              value={elt[d.slider.key] as number}
              disabled={!elt.show}
              onChange={(e) => patch(d.name, { [d.slider!.key]: Number(e.target.value) })}
            />
          </label>
        )}
        {d.position && (
          <label className={`flex items-center justify-between gap-2 pl-5 text-xs ${elt.show ? '' : 'opacity-40'}`}>
            Position
            <select
              className={selectCls}
              value={elt.position as string}
              disabled={!elt.show}
              onChange={(e) => patch(d.name, { position: e.target.value })}
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {OVERLAY_CATEGORIES.map((cat) => {
        const descs = OVERLAY_CONTROLS.filter((d) => categoryOf.get(d.name) === cat.id);
        if (descs.length === 0) return null;
        return (
          <CollapsibleSection key={cat.id} label={cat.label} defaultOpen={cat.id !== 'backdrop'}>
            {descs.map(renderControl)}
          </CollapsibleSection>
        );
      })}
    </div>
  );
}

const FACE_MODE_OPTIONS: { value: FaceMapping; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'timbre', label: 'Expression → timbre' },
  { value: 'chord', label: 'Expression → chord' },
  { value: 'controls', label: 'Head/face pose → chord' },
];

const FACE_MODE_HINT: Record<FaceMapping, string> = {
  none: 'No face detection. Pick a mode to map your expression to sound. Uses the same camera as hand tracking; loads a small face model on first use.',
  timbre: 'Smile → brighter tone, open mouth → vibrato — shaping the notes your hands play.',
  chord: "Your expression plays a diatonic triad on the right hand's scale (needs a 7-note scale).",
  controls:
    "Deliberate head/face moves play chords — turn to pick the chord, open your mouth to sound it (needs a 7-note scale). The easy, controllable alternative to emotion mode.",
};

/** Modes whose chord needs a seven-note scale (a diatonic triad is otherwise
 *  undefined): emotion `chord` and head-pose `controls`. */
const needsSevenNote = (m: FaceMapping): boolean => m === 'chord' || m === 'controls';

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

const VOICING_LABELS: Record<VoicingId, string> = {
  spread: 'Open (spread)',
  bassTriad: 'Bass + triad',
  close: 'Close',
  shell: 'Shell (sparse)',
  power: 'Power (5ths)',
};

const RENDERING_LABELS: Record<RenderingId, string> = {
  sustained: 'Sustained pad',
  strum: 'Strum',
  arpUp: 'Arpeggio ↑',
  arpDown: 'Arpeggio ↓',
  arpUpDown: 'Arpeggio ↑↓',
  pulse: 'Pulse',
  alberti: 'Alberti',
};

/** Sound settings for the face chord — shown when chord mapping is active. */
function ChordControls() {
  const { state, set } = useDialsSettings();
  const v = state.effective;
  const rendering = v['faceChord.rendering'] as RenderingId;
  const tempoRelevant = isTempoRendering(rendering);

  return (
    <div className="space-y-2 border-l-2 border-amber-300/30 pl-3">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-amber-300/70">Chord sound</h4>
      <label className="flex items-center justify-between gap-2 text-xs">
        Sound
        <select
          className={selectCls}
          value={v['faceChord.sound'] as string}
          onChange={(e) => set('faceChord.sound', e.target.value)}
        >
          {SOUND_IDS.map((id) => (
            <option key={id} value={id}>{SOUNDS[id].name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Volume
        <input
          type="range" min={0} max={1} step={0.01} value={v['faceChord.volume'] as number}
          onChange={(e) => set('faceChord.volume', Number(e.target.value))}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Voicing
        <select
          className={selectCls}
          value={v['faceChord.voicing'] as string}
          onChange={(e) => set('faceChord.voicing', e.target.value as VoicingId)}
        >
          {VOICINGS.map((vc) => (
            <option key={vc} value={vc}>{VOICING_LABELS[vc]}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Rendering
        <select
          className={selectCls}
          value={rendering}
          onChange={(e) => set('faceChord.rendering', e.target.value as RenderingId)}
        >
          {RENDERINGS.map((r) => (
            <option key={r} value={r}>{RENDERING_LABELS[r]}</option>
          ))}
        </select>
      </label>
      <label className={`flex items-center justify-between gap-2 text-xs ${tempoRelevant ? '' : 'opacity-40'}`}>
        Tempo {v['faceChord.bpm'] as number} bpm
        <input
          type="range" min={40} max={200} step={1} value={v['faceChord.bpm'] as number}
          onChange={(e) => set('faceChord.bpm', Number(e.target.value))}
        />
      </label>
      {tempoRelevant && (
        <p className="text-[10px] leading-relaxed text-white/40">
          Tempo modes articulate best with a crisp sound (organ / glass / bell); a slow-attack
          pad blurs fast arpeggios into a wash.
        </p>
      )}
    </div>
  );
}

/**
 * Per-expression mapping editor (advanced). The per-emotion SENSITIVITY sliders
 * apply in any active face mode (the classifier runs in timbre mode too — it
 * feeds the readout/status there), so they show whenever a mapping is on. The
 * scale-degree dropdown + live chord MIDI are chord-specific, so they appear only
 * in chord mode (where `neutral` also gets a row — its rest chord). The (global)
 * rendering lives in ChordControls above. The two maps are single dial values
 * (`faceExpr.sensitivity` / `faceExpr.degrees`); each edit writes a merged copy.
 */
function ExpressionMapping({ chordMode }: { chordMode: boolean }) {
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

  const chordMidi = (degree: number): number[] => {
    if (degree < 0) return []; // SILENCE_DEGREE → no chord
    const triad = diatonicTriad(
      {
        root: v['right.root'] as number,
        type: v['right.type'] as ScaleTypeId,
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
                  {degree < 0
                    ? 'silence (no chord)'
                    : midi.length
                      ? midi.join(' ')
                      : '— (needs a 7-note scale)'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

function FaceControls() {
  const { state, set } = useDialsSettings();
  const v = state.effective;
  const faceMapping = v['face.mapping'] as FaceMapping;
  const sevenNote = isSevenNoteScale(v['right.type'] as ScaleTypeId);

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-2 text-xs">
        Mapping
        <select
          className={selectCls}
          value={faceMapping}
          onChange={(e) => dispatchDialSet('face.mapping', e.target.value as FaceMapping)}
        >
          {FACE_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} disabled={needsSevenNote(o.value) && !sevenNote}>
              {o.label}
              {needsSevenNote(o.value) && !sevenNote ? ' (needs 7-note scale)' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-between gap-2">
        <FaceStatusReadout active={faceMapping !== 'none'} showLabel={faceMapping !== 'controls'} />
        {/* Emotion how-to help is for the expression modes; pose mode has its own moves list. */}
        {faceMapping !== 'none' && faceMapping !== 'controls' && <ExpressionHelpButton />}
      </div>
      {needsSevenNote(faceMapping) && !sevenNote && (
        <p className="text-[10px] leading-relaxed text-amber-300/80">
          This mode needs a 7-note scale (Major / Natural Minor / Harmonic Minor) on the right hand.
        </p>
      )}
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

function RecordingControls() {
  const formats = useControls((s) => s.recordingFormats);
  const setFormat = useControls((s) => s.setRecordingFormat);

  return (
    <div className="space-y-2">
      {RECORDING_FORMATS.map((f) => (
        <Toggle
          key={f.id}
          label={f.label}
          checked={formats.includes(f.id)}
          onChange={(v) => setFormat(f.id, v)}
        />
      ))}
      <p className="text-[10px] leading-relaxed text-white/40">
        On stop, your take is saved in each selected format. If your browser
        supports it you'll be asked where to save; otherwise it lands in Downloads.
      </p>
    </div>
  );
}

const EFFECT_LABELS: Record<FingerTarget, string> = {
  none: 'Off',
  brightness: 'Brightness',
  vibrato: 'Vibrato',
  pan: 'Pan',
  pitchBend: 'Pitch bend',
  octave: 'Octave',
  gate: 'Gate',
};

/**
 * Hand→sound mapping: the note SOURCE (index fingertip or the steadier wrist), the
 * whole-hand knobs (fist-mute, open-brightness, pinch-vibrato, scale snap), and the
 * per-finger→effect routing (pinch a finger toward the thumb to drive its effect,
 * continuous or as a discrete trigger). Grounded in the hand-control research (#80).
 */
function HandControls() {
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

export default function DialsControlsPanel() {
  const { state, set } = useDialsSettings();
  const v = state.effective;
  const syncHands = v['master.syncHands'] as boolean;

  return (
    <div className="space-y-1">
      {/* Sound — the live-performance knobs, open by default. */}
      <TopSection label="Sound" defaultOpen>
        <label className="flex items-center justify-between gap-2 text-xs">
          Master volume
          <input
            type="range" min={0} max={1} step={0.01} value={v['master.volume'] as number}
            onChange={(e) => set('master.volume', Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={syncHands} onChange={(e) => dispatchDialSet('master.syncHands', e.target.checked)} />
          Sync both hands
        </label>
        <VoiceControls side="right" />
        {!syncHands && <VoiceControls side="left" />}
      </TopSection>

      <TopSection label="Hand">
        <HandControls />
      </TopSection>

      <TopSection label="Face">
        <FaceControls />
      </TopSection>

      <TopSection label="Overlay">
        <OverlayControls />
      </TopSection>

      <TopSection label="Recording">
        <RecordingControls />
      </TopSection>

      <TopSection label="Keyboard">
        <div className="text-[10px] leading-relaxed text-white/50">
          <p>↑ / ↓ — octave shift</p>
          <p>← / → — less / more scale-snap</p>
          <p>m — mute</p>
        </div>
      </TopSection>
    </div>
  );
}
