/**
 * ControlsPanel — schema-light UI bound to the Zustand control store. Changing
 * any value updates the store; the `store-controls` DAG node reads it on the
 * next tick, so edits take effect live without rebuilding the graph.
 *
 * Sections: per-hand voice, master/sync, the composable Overlay elements, and
 * named Presets (save/load/delete via the zodal-backed preset store).
 *
 * Renders just the controls *content* (no outer card); the host (App) wraps it
 * in a collapsible translucent overlay so the video stays the focus.
 */
import { useState, type ReactNode } from 'react';
import { NOTES, SCALE_TYPES, isSevenNoteScale, type ScaleTypeId } from '@/music/theory';
import { INSTRUMENTS, INSTRUMENT_IDS } from '@/music/instruments';
import { VOICINGS, RENDERINGS, isTempoRendering, type VoicingId, type RenderingId } from '@/music/voicing';
import type { FaceMapping } from '@/nodes';
import { useControls, type VoiceControl } from './store';
import { useFaceStatus } from './faceStatus';
import { usePresets } from './usePresets';
import { RECORDING_FORMATS } from './recording/formats';

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

function VoiceControls({ side }: { side: 'right' | 'left' }) {
  const voice = useControls((s) => s[side]);
  const setVoice = useControls((s) => s.setVoice);
  const color = side === 'right' ? 'text-emerald-400' : 'text-blue-400';

  return (
    <div className="space-y-2">
      <h3 className={`text-[11px] font-bold uppercase tracking-widest ${color}`}>{side} hand</h3>
      <label className="flex items-center justify-between gap-2 text-xs">
        Instrument
        <select
          className={selectCls}
          value={voice.instrument}
          onChange={(e) => setVoice(side, { instrument: e.target.value as VoiceControl['instrument'] })}
        >
          {INSTRUMENT_IDS.map((id) => (
            <option key={id} value={id}>{INSTRUMENTS[id].name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Root
        <select
          className={selectCls}
          value={voice.root}
          onChange={(e) => setVoice(side, { root: Number(e.target.value) })}
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
          value={voice.type}
          onChange={(e) => setVoice(side, { type: e.target.value as ScaleTypeId })}
        >
          {Object.entries(SCALE_TYPES).map(([id, s]) => (
            <option key={id} value={id}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Octaves
        <input
          type="range" min={1} max={4} step={1} value={voice.octaves}
          onChange={(e) => setVoice(side, { octaves: Number(e.target.value) })}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Base octave
        <input
          type="range" min={1} max={5} step={1} value={voice.baseOctave}
          onChange={(e) => setVoice(side, { baseOctave: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}

/**
 * Overlay settings, grouped by the element {@link OVERLAY_CATEGORIES} into
 * collapsible sections — the "target space of the mapping" framing: Input
 * features (what the camera detected), Output features (what gestures map to),
 * Guides, and the Backdrop. New overlay elements slot into their category here.
 */
function OverlayControls() {
  const overlay = useControls((s) => s.overlay);
  const set = useControls((s) => s.setOverlayElement);
  const faceActive = useControls((s) => s.faceMapping) !== 'none';

  return (
    <div className="space-y-3">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70">Overlay</h3>

      <CollapsibleSection label="Input features">
        <Toggle label="Hand landmarks" checked={overlay.landmarks.show} onChange={(v) => set('landmarks', { show: v })} />
        <Toggle
          label="Face mesh"
          checked={overlay.faceLandmarks.show}
          onChange={(v) => set('faceLandmarks', { show: v })}
          disabled={!faceActive}
        />
        {!faceActive && (
          <p className="text-[10px] leading-relaxed text-white/30">
            Face mesh appears once a face mapping is on (the model loads then).
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection label="Output features">
        <Toggle label="Note names" checked={overlay.markers.showNotes} onChange={(v) => set('markers', { showNotes: v })} />
        <Toggle label="Control markers" checked={overlay.markers.show} onChange={(v) => set('markers', { show: v })} />
        <Toggle label="Face expression" checked={overlay.faceExpression.show} onChange={(v) => set('faceExpression', { show: v })} />
        <Toggle label="Timbre levels" checked={overlay.timbreLevels.show} onChange={(v) => set('timbreLevels', { show: v })} />
        <Toggle label="Chord highlight" checked={overlay.chordGuide.show} onChange={(v) => set('chordGuide', { show: v })} />
      </CollapsibleSection>

      <CollapsibleSection label="Guides">
        <Toggle label="Scale guide" checked={overlay.scaleGuide.show} onChange={(v) => set('scaleGuide', { show: v })} />
        <Toggle label="Scale guide labels" checked={overlay.scaleGuide.showLabels} onChange={(v) => set('scaleGuide', { showLabels: v })} />
        <Toggle label="Index-finger guide" checked={overlay.indexGuide.show} onChange={(v) => set('indexGuide', { show: v })} />
        <Toggle label="Index guide dashed" checked={overlay.indexGuide.dashed} onChange={(v) => set('indexGuide', { dashed: v })} />
      </CollapsibleSection>

      <CollapsibleSection label="Backdrop" defaultOpen={false}>
        <Toggle label="Video backdrop" checked={overlay.video.show} onChange={(v) => set('video', { show: v })} />
        <label className="flex items-center justify-between gap-2 text-xs">
          Background opacity
          <input
            type="range" min={0} max={1} step={0.01} value={overlay.video.alpha}
            onChange={(e) => set('video', { alpha: Number(e.target.value) })}
          />
        </label>
      </CollapsibleSection>
    </div>
  );
}

const FACE_MODE_OPTIONS: { value: FaceMapping; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'timbre', label: 'Expression → timbre' },
  { value: 'chord', label: 'Expression → chord' },
];

const FACE_MODE_HINT: Record<FaceMapping, string> = {
  none: 'No face detection. Pick a mode to map your expression to sound. Uses the same camera as hand tracking; loads a small face model on first use.',
  timbre: 'Smile → brighter tone, open mouth → vibrato — shaping the notes your hands play.',
  chord: "Your expression plays a diatonic triad on the right hand's scale (needs a 7-note scale).",
};

/** Live face-model status + detected expression, driven by the engine (#65). */
function FaceStatusReadout({ active }: { active: boolean }) {
  const status = useFaceStatus((s) => s.status);
  const label = useFaceStatus((s) => s.label);

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
  const chord = useControls((s) => s.faceChord);
  const set = useControls((s) => s.setFaceChord);
  const tempoRelevant = isTempoRendering(chord.rendering);

  return (
    <div className="space-y-2 border-l-2 border-amber-300/30 pl-3">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-amber-300/70">Chord sound</h4>
      <label className="flex items-center justify-between gap-2 text-xs">
        Instrument
        <select
          className={selectCls}
          value={chord.instrument}
          onChange={(e) => set({ instrument: e.target.value as VoiceControl['instrument'] })}
        >
          {INSTRUMENT_IDS.map((id) => (
            <option key={id} value={id}>{INSTRUMENTS[id].name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Volume
        <input
          type="range" min={0} max={1} step={0.01} value={chord.volume}
          onChange={(e) => set({ volume: Number(e.target.value) })}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Voicing
        <select
          className={selectCls}
          value={chord.voicing}
          onChange={(e) => set({ voicing: e.target.value as VoicingId })}
        >
          {VOICINGS.map((v) => (
            <option key={v} value={v}>{VOICING_LABELS[v]}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Rendering
        <select
          className={selectCls}
          value={chord.rendering}
          onChange={(e) => set({ rendering: e.target.value as RenderingId })}
        >
          {RENDERINGS.map((r) => (
            <option key={r} value={r}>{RENDERING_LABELS[r]}</option>
          ))}
        </select>
      </label>
      <label className={`flex items-center justify-between gap-2 text-xs ${tempoRelevant ? '' : 'opacity-40'}`}>
        Tempo {chord.bpm} bpm
        <input
          type="range" min={40} max={200} step={1} value={chord.bpm}
          onChange={(e) => set({ bpm: Number(e.target.value) })}
        />
      </label>
      {tempoRelevant && (
        <p className="text-[10px] leading-relaxed text-white/40">
          Tempo modes articulate best with a crisp instrument (organ / glass / bell); a slow-attack
          pad blurs fast arpeggios into a wash.
        </p>
      )}
    </div>
  );
}

function FaceControls() {
  const faceMapping = useControls((s) => s.faceMapping);
  const setFaceMapping = useControls((s) => s.setFaceMapping);
  const rightType = useControls((s) => s.right.type);
  const sevenNote = isSevenNoteScale(rightType);

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70">Face control</h3>
      <label className="flex items-center justify-between gap-2 text-xs">
        Mapping
        <select
          className={selectCls}
          value={faceMapping}
          onChange={(e) => setFaceMapping(e.target.value as FaceMapping)}
        >
          {FACE_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} disabled={o.value === 'chord' && !sevenNote}>
              {o.label}
              {o.value === 'chord' && !sevenNote ? ' (needs 7-note scale)' : ''}
            </option>
          ))}
        </select>
      </label>
      <FaceStatusReadout active={faceMapping !== 'none'} />
      {faceMapping === 'chord' && !sevenNote && (
        <p className="text-[10px] leading-relaxed text-amber-300/80">
          Chord mode needs a 7-note scale (Major / Natural Minor / Harmonic Minor) on the right hand.
        </p>
      )}
      <p className="text-[10px] leading-relaxed text-white/40">{FACE_MODE_HINT[faceMapping]}</p>
      {faceMapping === 'chord' && <ChordControls />}
    </div>
  );
}

function RecordingControls() {
  const formats = useControls((s) => s.recordingFormats);
  const setFormat = useControls((s) => s.setRecordingFormat);

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70">Recording</h3>
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

function PresetControls() {
  const { presets, busy, save, load, remove } = usePresets();
  const [name, setName] = useState('');

  const doSave = () => {
    void save(name);
    setName('');
  };

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70">Presets</h3>
      <div className="flex gap-1">
        <input
          className={`${selectCls} flex-1`}
          placeholder="Name this setup…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doSave();
          }}
        />
        <button
          type="button"
          className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-40"
          disabled={busy || !name.trim()}
          onClick={doSave}
        >
          Save
        </button>
      </div>
      {presets.length === 0 ? (
        <p className="text-[10px] text-white/40">No saved presets yet.</p>
      ) : (
        <ul className="space-y-1">
          {presets.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                className="flex-1 truncate text-left hover:text-emerald-300"
                title="Load this preset"
                onClick={() => void load(p.id)}
              >
                {p.name}
              </button>
              <button
                type="button"
                className="px-1 text-white/40 hover:text-red-400"
                title="Delete this preset"
                onClick={() => void remove(p.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ControlsPanel() {
  const syncHands = useControls((s) => s.syncHands);
  const setSync = useControls((s) => s.setSync);
  const masterVolume = useControls((s) => s.masterVolume);
  const setMasterVolume = useControls((s) => s.setMasterVolume);

  return (
    <div className="space-y-4">
      <div>
        <label className="flex items-center justify-between gap-2 text-xs">
          Master volume
          <input
            type="range" min={0} max={1} step={0.01} value={masterVolume}
            onChange={(e) => setMasterVolume(Number(e.target.value))}
          />
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={syncHands} onChange={(e) => setSync(e.target.checked)} />
          Sync both hands
        </label>
      </div>
      <VoiceControls side="right" />
      {!syncHands && <VoiceControls side="left" />}
      <div className="border-t border-white/10 pt-3">
        <OverlayControls />
      </div>
      <div className="border-t border-white/10 pt-3">
        <FaceControls />
      </div>
      <div className="border-t border-white/10 pt-3">
        <RecordingControls />
      </div>
      <div className="border-t border-white/10 pt-3">
        <PresetControls />
      </div>
      <div className="border-t border-white/10 pt-3 text-[10px] leading-relaxed text-white/50">
        <p className="mb-1 font-bold uppercase tracking-widest text-white/70">Keyboard</p>
        <p>↑ / ↓ — octave shift</p>
        <p>← / → — less / more scale-snap</p>
        <p>m — mute</p>
      </div>
    </div>
  );
}
