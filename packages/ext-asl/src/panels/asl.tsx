/**
 * The SIGN LANGUAGE section of the settings panel: the reader's switches and tuning (the
 * `asl` dial) and, for the ASL chords, the key and what each letter plays in it. The key and
 * the chord sound are the face chords' dials (`faceChord.*`), written here too so the chord
 * instrument is set up in one place. Every discrete control dispatches (the single write
 * path); the two sliders write on drag (Decision B).
 */
import { dispatchDialPatch, dispatchDialSet, dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { keyName, NOTE_LETTERS, NOTES, SCALE_TYPES, type ScaleTypeId } from '@thoremin/sdk/music/theory';
import { SOUNDS, type SoundId } from '@thoremin/sdk/music/sounds';
import { MOTION_SIGNS, signText } from '@thoremin/asl';
import { letterChordName } from '../nodes/sign_chord';
import { DEFAULT_ASL_DIAL, type AslDialParams } from '../nodes/asl_signs';
import { useAslStatus } from '../app/aslStatus';

/** What the reader sees right now. */
export function AslReadout() {
  const live = useAslStatus((s) => s.live);
  const phase = live.status?.phase;
  const msg = phase && phase !== 'ready' && phase !== 'active' ? live.status!.message : null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 p-2 text-xs" data-testid="asl-live" data-state={live.text ? 'reading' : live.present ? 'hand' : 'idle'}>
      <span className="text-white/80">{msg ?? (live.text ? `Reading: ${live.text}` : live.present ? 'Hand in view, no sign yet' : 'Show a hand to the camera')}</span>
      {live.text && <span className="shrink-0 font-mono text-amber-300">{Math.round(live.confidence * 100)}%</span>}
    </div>
  );
}

export function AslControls() {
  const { state } = useDialsSettings();
  const v = state.effective;
  const c = { ...DEFAULT_ASL_DIAL, ...((v.asl ?? {}) as Partial<AslDialParams>) };
  const root = (v['faceChord.chordRoot'] as number | undefined) ?? 0;
  const type = ((v['faceChord.chordType'] as ScaleTypeId | undefined) ?? 'major') as ScaleTypeId;
  const custom = v['faceChord.chordSource'] === 'custom';
  const sound = (v['faceChord.sound'] as SoundId | undefined) ?? 'warmPad';
  const volume = (v['faceChord.volume'] as number | undefined) ?? 0.22;
  const key = { root, type, octaves: 2, baseOctave: 3 };
  const setKey = (r: number, t: ScaleTypeId) =>
    dispatchDialPatch([
      ['faceChord.chordRoot', r],
      ['faceChord.chordType', t],
      ['faceChord.chordSource', 'custom'],
    ]);
  return (
    <div className="space-y-2">
      <AslReadout />
      <p className="text-[10px] leading-relaxed text-white/50">
        Fingerspell to the camera with either hand. The 24 held letters are read from the hand's shape; J, Z and the words ({MOTION_SIGNS.filter((s) => s.length > 1).map(signText).join(', ')}) are movements, read over the last second or so.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={c.enabled} onChange={(e) => dispatchDialSetIn('asl.enabled', e.target.checked)} />
        Read ASL signs
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={c.motion} disabled={!c.enabled} onChange={(e) => dispatchDialSetIn('asl.motion', e.target.checked)} />
        Movement signs too (J, Z, words)
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="A sign is named only when its score reaches this.">
        <span>Confidence ({Math.round(c.minConfidence * 100)}%)</span>
        <input type="range" min={0.2} max={0.95} step={0.05} value={c.minConfidence} disabled={!c.enabled} className="w-[45%]" onChange={(e) => dispatchDialSetIn('asl.minConfidence', Number(e.target.value))} />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="How long the reading takes to settle; 0 shows every frame as is.">
        <span>Smoothing ({c.smoothing.toFixed(2)} s)</span>
        <input type="range" min={0} max={0.5} step={0.02} value={c.smoothing} disabled={!c.enabled} className="w-[45%]" onChange={(e) => dispatchDialSetIn('asl.smoothing', Number(e.target.value))} />
      </label>
      <div className="space-y-2 border-t border-white/10 pt-2">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={c.chords} disabled={!c.enabled} onChange={(e) => dispatchDialSetIn('asl.chords', e.target.checked)} />
          A..G play chords of the key
        </label>
        <label className="flex items-center gap-2 text-xs" title="On: a chord keeps sounding while you sign other letters, until the next chord letter or your hand leaves. Off: only while A..G is held.">
          <input type="checkbox" checked={c.holdChord} disabled={!c.chords} onChange={(e) => dispatchDialSetIn('asl.holdChord', e.target.checked)} />
          Hold the chord between letters
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          Key
          <span className="flex gap-1">
            <select className={selectCls} value={root} disabled={!c.chords} onChange={(e) => setKey(Number(e.target.value), type)}>
              {/* Spelled as the key is written (Bb, not A#): the letters below follow it. */}
              {NOTES.map((n, i) => (
                <option key={n} value={i}>{keyName({ root: i, type })}</option>
              ))}
            </select>
            <select className={selectCls} value={type} disabled={!c.chords} onChange={(e) => setKey(root, e.target.value as ScaleTypeId)}>
              {(Object.keys(SCALE_TYPES) as ScaleTypeId[]).map((t) => (
                <option key={t} value={t}>{SCALE_TYPES[t].name}</option>
              ))}
            </select>
          </span>
        </label>
        {!custom && c.chords && <p className="text-[10px] text-white/50">The key follows the melody scale until you pick one here.</p>}
        <label className="flex items-center justify-between gap-2 text-xs">
          Chord sound
          <select className={selectCls} value={sound} disabled={!c.chords} onChange={(e) => dispatchDialSet('faceChord.sound', e.target.value)}>
            {(Object.keys(SOUNDS) as SoundId[]).map((s) => (
              <option key={s} value={s}>{SOUNDS[s].name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>Chord volume ({Math.round(volume * 100)}%)</span>
          <input type="range" min={0} max={1} step={0.01} value={volume} disabled={!c.chords} className="w-[45%]" onChange={(e) => dispatchDialSet('faceChord.volume', Number(e.target.value))} />
        </label>
        {c.chords && custom && (
          <div className="grid grid-cols-7 gap-1 text-center font-mono text-[10px]" data-testid="asl-chord-map">
            {NOTE_LETTERS.map((l) => (
              <div key={l} className="rounded bg-white/5 py-1">
                <div className="text-white/60">{l}</div>
                <div className="text-amber-300">{letterChordName(key, l)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
