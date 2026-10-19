/**
 * The CHORD MAP section of the settings panel: a key's chords on the screen, the chord hand
 * pointing at one. Every control writes a leaf of the structured `chordMap` dial through
 * `dispatchDialSetIn` (the single write path). The KEY is the chord-source scale (the Sound
 * section's root and scale, or the Chord sound section's custom chord scale), and a held
 * chord sounds as the Chord sound section says (sound, voicing, rendering), so this section
 * only says how the chords are laid out and played. The live readout ({@link ChordMapReadout})
 * is shown here and under the chosen row in the Instruments list.
 */
import { dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { describeChordMapLive, useChordMapStatus } from '../app/chordMapStatus';
import { CHORD_MAP_LAYOUTS, LAYOUTS } from '../lib/chord_map';
import { CHORD_MAP_PLAY, CHORD_MAP_POINTS, type ChordMapDialParams } from '../nodes/chord_map';
import { PLAYER_HANDS } from '../nodes/air_bass';

const PLAY_LABEL: Record<ChordMapDialParams['play'], string> = {
  hold: 'hold the chord, melody with the other hand',
  strum: 'strum it with the other hand',
};
const HAND_LABEL: Record<ChordMapDialParams['chordHand'], string> = {
  left: 'left hand points at chords',
  right: 'right hand points at chords',
};
const POINT_LABEL: Record<ChordMapDialParams['point'], string> = {
  palm: 'palm centre',
  indexTip: 'index fingertip',
};

/** What the chord map is doing right now, from the engine loop's reporter. */
export function ChordMapReadout() {
  const live = useChordMapStatus((s) => s.live);
  const share = live.strums > 0 ? Math.round((100 * live.predicted) / live.strums) : 0;
  return (
    <div
      className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs"
      data-testid="chord-map-live"
      data-state={live.enabled ? (live.chord ? 'playing' : 'ready') : 'off'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-white/80">{describeChordMapLive(live)}</span>
        {live.enabled && live.play === 'strum' && live.strums > 0 && (
          <span className="shrink-0 font-mono text-emerald-300" title="strums, and the share predicted ahead of the strum">
            {live.strums} · {share}%
          </span>
        )}
      </div>
    </div>
  );
}

function Range({ label, path, value, min, max, step, enabled, title }: { label: string; path: string; value: number; min: number; max: number; step: number; enabled: boolean; title?: string }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs" title={title}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={!enabled} className="w-[45%]" onChange={(e) => dispatchDialSetIn(path, Number(e.target.value))} />
    </label>
  );
}

export function ChordMapControls() {
  const { state } = useDialsSettings();
  const c = (state.effective.chordMap ?? {}) as Partial<ChordMapDialParams>;
  const enabled = c.enabled === true;
  const layout = c.layout ?? 'harmonic';
  const play = c.play ?? 'hold';
  const chordHand = c.chordHand ?? 'left';
  const point = c.point ?? 'palm';
  const split = c.split ?? 0.65;
  const cellSize = c.cellSize ?? 0.2;
  const melody = c.melody ?? true;
  const melodyVolume = c.melodyVolume ?? 0.45;
  const volume = c.volume ?? 0.7;
  const captions = c.captions ?? true;
  return (
    <div className="space-y-2" data-testid="chord-map-controls">
      <ChordMapReadout />
      <p className="text-[10px] leading-relaxed text-white/50">
        The seven chords of the key are drawn on your chord hand's side of the screen: hold your palm over one to play it. On the harmonic map each neighbour is one move away: across is a fourth, the diagonals a third (two notes shared) or a second. Holding, your other hand's height plays a melody on the chord's notes; strumming, your other hand strums it. The key is the Sound section's root and scale; a held chord sounds as the Chord sound section says.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => dispatchDialSetIn('chordMap.enabled', e.target.checked)} />
        Play the chord map
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Layout
        <select className={selectCls} value={layout} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.layout', e.target.value)}>
          {CHORD_MAP_LAYOUTS.map((l) => (
            <option key={l} value={l}>
              {LAYOUTS[l].label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Sound it
        <select className={selectCls} value={play} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.play', e.target.value)}>
          {CHORD_MAP_PLAY.map((p) => (
            <option key={p} value={p}>
              {PLAY_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Chord hand
        <select className={selectCls} value={chordHand} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.chordHand', e.target.value)}>
          {PLAYER_HANDS.map((h) => (
            <option key={h} value={h}>
              {HAND_LABEL[h]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Pointing with
        <select className={selectCls} value={point} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.point', e.target.value)}>
          {CHORD_MAP_POINTS.map((p) => (
            <option key={p} value={p}>
              {POINT_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <Range label={`Chords' share of the screen (${Math.round(split * 100)}%)`} path="chordMap.split" value={split} min={0.3} max={0.9} step={0.05} enabled={enabled} />
      {layout === 'harmonic' && (
        <Range label={`Chord size (${Math.round(cellSize * 100)}% of the height)`} path="chordMap.cellSize" value={cellSize} min={0.1} max={0.45} step={0.01} enabled={enabled} title="Larger chords are easier to hit; smaller ones show more of the map." />
      )}
      {layout === 'harmonic' && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={captions} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.captions', e.target.checked)} />
          Show each move from the chord (4th up, 3rd down...)
        </label>
      )}
      {play === 'hold' && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={melody} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.melody', e.target.checked)} />
          Melody on the chord's notes with the other hand
        </label>
      )}
      {play === 'hold' && melody && (
        <Range label={`Melody volume (${Math.round(melodyVolume * 100)}%)`} path="chordMap.melodyVolume" value={melodyVolume} min={0} max={1} step={0.05} enabled={enabled} />
      )}
      {play === 'strum' && <Range label={`Strum volume (${Math.round(volume * 100)}%)`} path="chordMap.volume" value={volume} min={0} max={1} step={0.05} enabled={enabled} />}
    </div>
  );
}
