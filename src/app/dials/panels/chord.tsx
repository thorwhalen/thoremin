/**
 * The CHORD-SOUND section of the settings panel: the sound/volume/voicing/rendering of
 * the face-driven chord, plus the chord-SOURCE scale picker (#75) it draws its chords
 * from. Shown by the face panel whenever a chord mapping (emotion or pose) is active.
 */
import { NOTES, SCALE_TYPES, defaultChordSpecFor, melodyNotesOutsideChord, type ScaleTypeId } from '@/music/theory';
import { SOUNDS, SOUND_IDS } from '@/music/sounds';
import { VOICINGS, RENDERINGS, isTempoRendering, type VoicingId, type RenderingId } from '@/music/voicing';
import { useDialsSettings } from '../useDialsSettings';
import { VOICING_LABELS, RENDERING_LABELS } from '../labels';
import { selectCls } from '../primitives';

/**
 * The chord-source scale picker (#75): WHERE the face/pose chords are drawn from,
 * decoupled from the right-hand melody scale. 'Auto' follows the melody (a smart
 * default that makes pentatonic-melody + chords "just work" with zero config);
 * 'Custom' pins any scale as the source, with a non-blocking warning naming the
 * melody notes that fall outside the chosen source (they may clash — still allowed).
 */
function ChordSourceControls() {
  const { state, set } = useDialsSettings();
  const v = state.effective;
  const melody = { root: v['right.root'] as number, type: v['right.type'] as ScaleTypeId };
  const source = v['faceChord.chordSource'] as 'auto' | 'custom';
  const chordRoot = v['faceChord.chordRoot'] as number;
  const chordType = v['faceChord.chordType'] as ScaleTypeId;
  const auto = defaultChordSpecFor(melody);
  // The warning is authoritative on the subset test and only meaningful for a CUSTOM
  // source — 'auto' is by construction the recommended embedding, so it never warns.
  const outside = source === 'custom' ? melodyNotesOutsideChord(melody, { root: chordRoot, type: chordType }) : [];

  return (
    <div className="space-y-2 border-t border-white/10 pt-2">
      <label className="flex items-center justify-between gap-2 text-xs">
        Chord scale
        <select
          className={selectCls}
          value={source}
          onChange={(e) => {
            const next = e.target.value as 'auto' | 'custom';
            // On auto→custom, seed the custom root/type from the currently-sounding auto
            // source, so switching to Custom is INAUDIBLE until the user deliberately edits
            // it (otherwise chordRoot/chordType keep their C-major defaults and a non-C
            // melody's chords would jump into the wrong key on the mere mode flip).
            if (next === 'custom' && source !== 'custom') {
              set('faceChord.chordRoot', auto.root);
              set('faceChord.chordType', auto.type);
            }
            set('faceChord.chordSource', next);
          }}
        >
          <option value="auto">Auto (follow melody)</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {source === 'auto' ? (
        <p className="text-[10px] leading-relaxed text-white/40">
          Chords are drawn from{' '}
          <span className="text-white/70">
            {NOTES[auto.root]} {SCALE_TYPES[auto.type].name}
          </span>
          , matched to your melody scale.
        </p>
      ) : (
        <>
          <label className="flex items-center justify-between gap-2 text-xs">
            Chord root
            <select
              className={selectCls}
              value={chordRoot}
              onChange={(e) => set('faceChord.chordRoot', Number(e.target.value))}
            >
              {NOTES.map((n, i) => (
                <option key={n} value={i}>{n}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            Chord scale type
            <select
              className={selectCls}
              value={chordType}
              onChange={(e) => set('faceChord.chordType', e.target.value as ScaleTypeId)}
            >
              {Object.entries(SCALE_TYPES).map(([id, s]) => (
                <option key={id} value={id}>{s.name}</option>
              ))}
            </select>
          </label>
          {outside.length > 0 && (
            <p className="text-[10px] leading-relaxed text-amber-300/80">
              Heads up: {outside.join(', ')} {outside.length === 1 ? 'is' : 'are'} in your melody but
              not the chord scale — chords may clash with the melody. This is allowed; pick a chord
              scale that contains your melody for a "safe" fit.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Sound settings for the face chord — shown when chord mapping is active. */
export function ChordControls() {
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
      <ChordSourceControls />
    </div>
  );
}
