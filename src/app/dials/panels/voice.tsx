/**
 * The per-hand VOICE section of the settings panel: sound / root / scale / octave
 * range / base octave for one hand, read from and written to the dials store.
 */
import { NOTES, SCALE_TYPES, type ScaleTypeId } from '@/music/theory';
import { SOUNDS, SOUND_IDS } from '@/music/sounds';
import { dispatchDialPatch } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { voiceEditWrites, type VoiceField } from '../settingsStore';
import { selectCls } from '../primitives';

/**
 * One hand's voice (sound / root / scale / octaves / base octave), read from and
 * written to the dials store. Mirrors `setVoice`: when both hands are synced, a
 * non-sound edit on this hand also writes the other hand, so the two voices share
 * scale/root/octaves while each keeps its own sound.
 *
 * A synced voice edit is genuinely SEVERAL dial writes, so the discrete `<select>`s
 * dispatch one atomic `dial.patch` rather than N `dial.set`s — a half-mirrored voice
 * (one hand's scale changed, the other's not) must not be a reachable state.
 */
export function VoiceControls({ side }: { side: 'right' | 'left' }) {
  const { state, set } = useDialsSettings();
  const v = state.effective;
  const syncHands = v['master.syncHands'] as boolean;
  const color = side === 'right' ? 'text-emerald-400' : 'text-blue-400';

  // The dials writes for one voice edit — setVoice's sync-hands rule (mirror the whole
  // non-sound voice when synced, keep each hand's own sound), from the SSOT.
  const writesFor = (key: VoiceField, value: unknown) => voiceEditWrites(side, key, value, syncHands, v);

  /** A DISCRETE voice edit (a `<select>`) — through the registry, atomically. */
  const dispatchField = (key: VoiceField, value: unknown) => dispatchDialPatch(writesFor(key, value));

  /** A CONTINUOUS voice edit (a slider being dragged) — a direct write. Decision B: a
   *  write per pointer-move frame must not pay for dispatch. This and {@link setRange}
   *  are the ONLY sanctioned direct writers in this panel. */
  const setFieldLive = (key: VoiceField, value: unknown) => {
    for (const [k, val] of writesFor(key, value)) set(k, val);
  };

  // #63 octave RANGE thumbs. When the range is absent (a legacy pre-#63 voice), DERIVE
  // both thumbs from the `octaves` span — distributed across the two thumbs so an octaves=3
  // voice seats at the representable 3.0 (not capped to 2.0) — and show the TRUE audible
  // span in the readout (`octaves` itself), which for a legacy octaves=4 voice honestly
  // exceeds the slider's 3-octave max. The first drag then adopts the range representation.
  const octaves = v[`${side}.octaves`] as number;
  const rawLow = v[`${side}.rangeLow`];
  const rawHigh = v[`${side}.rangeHigh`];
  const rangeAbsent = typeof rawLow !== 'number' || typeof rawHigh !== 'number';
  const derivedHigh = Math.min(1, Math.max(0, octaves - 1));
  const derivedLow = Math.min(1, Math.max(0, octaves - 1 - derivedHigh));
  const rangeLow = rangeAbsent ? derivedLow : (rawLow as number);
  const rangeHigh = rangeAbsent ? derivedHigh : (rawHigh as number);
  const rangeSpan = rangeAbsent ? octaves : 1 + rangeLow + rangeHigh;

  /** The double-thumb range slider (continuous — a direct write, Decision B). */
  const setRange = (nextLow: number, nextHigh: number) => {
    // Keep `octaves` a truthful integer shadow (round(1+low+high)) so no reader sees the
    // two contradict. Re-snap the WHOLE non-sound voice across synced hands via the SSOT
    // (voiceEditWrites) — so a range edit re-converges diverged hands like every other
    // voice edit — then override the two range thumbs with the new values (applied last).
    const oct = Math.max(1, Math.min(4, Math.round(1 + nextLow + nextHigh)));
    const writes = voiceEditWrites(side, 'octaves', oct, syncHands, v);
    writes.push([`${side}.rangeLow`, nextLow], [`${side}.rangeHigh`, nextHigh]);
    if (syncHands) {
      const other = side === 'right' ? 'left' : 'right';
      writes.push([`${other}.rangeLow`, nextLow], [`${other}.rangeHigh`, nextHigh]);
    }
    for (const [k, val] of writes) set(k, val);
  };

  return (
    <div className="space-y-2">
      <h3 className={`text-[11px] font-bold uppercase tracking-widest ${color}`}>{side} hand</h3>
      <label className="flex items-center justify-between gap-2 text-xs">
        Sound
        <select
          className={selectCls}
          value={v[`${side}.sound`] as string}
          onChange={(e) => dispatchField('sound', e.target.value)}
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
          onChange={(e) => dispatchField('root', Number(e.target.value))}
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
          onChange={(e) => dispatchField('type', e.target.value as ScaleTypeId)}
        >
          {Object.entries(SCALE_TYPES).map(([id, s]) => (
            <option key={id} value={id}>{s.name}</option>
          ))}
        </select>
      </label>
      {/* #63 octave RANGE — a "double-thumb" span around an always-covered middle octave.
          Two stacked native sliders (down/up extension) keep it touch-friendly and dependency-
          free: the ↓ thumb extends up to a full octave below the middle, the ↑ thumb up to a
          full octave above, so the span is a continuous 1..3 octaves that always includes the
          middle. Overlay guides + the audible range update live from the regenerated scale. */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span>Range</span>
          <span className="text-[10px] text-white/50">{rangeSpan.toFixed(1)} oct</span>
        </div>
        <label className="flex items-center gap-2 text-[10px] text-white/50" title="Extend the range below the middle octave">
          <span className="w-4 shrink-0 text-center" aria-hidden>↓</span>
          <input
            type="range" min={0} max={1} step={0.01} value={rangeLow} className="flex-1"
            aria-label={`${side} hand range below middle octave`}
            onChange={(e) => setRange(Number(e.target.value), rangeHigh)}
          />
        </label>
        <label className="flex items-center gap-2 text-[10px] text-white/50" title="Extend the range above the middle octave">
          <span className="w-4 shrink-0 text-center" aria-hidden>↑</span>
          <input
            type="range" min={0} max={1} step={0.01} value={rangeHigh} className="flex-1"
            aria-label={`${side} hand range above middle octave`}
            onChange={(e) => setRange(rangeLow, Number(e.target.value))}
          />
        </label>
      </div>
      <label className="flex items-center justify-between gap-2 text-xs">
        Base octave
        <input
          type="range" min={1} max={5} step={1} value={v[`${side}.baseOctave`] as number}
          onChange={(e) => setFieldLive('baseOctave', Number(e.target.value))}
        />
      </label>
    </div>
  );
}
