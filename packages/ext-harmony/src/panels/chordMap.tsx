/**
 * The CHORD MAP section of the settings panel: a key's chords on the screen, the chord hand
 * pointing at one. Every control writes a leaf of the structured `chordMap` dial through
 * `dispatchDialSetIn` (the single write path). The KEY is the chord-source scale (the Sound
 * section's root and scale, or the Chord sound section's custom chord scale), and a held
 * chord sounds as the Chord sound section says (sound, voicing, rendering), so this section
 * only says how the chords are laid out and played. The live readout ({@link ChordMapReadout})
 * is shown here and under the chosen row in the Instruments list.
 */
import { dispatchDialPatch, dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { describeChordMapLive, useChordMapStatus } from '../app/chordMapStatus';
import { CHORD_MAP_LAYOUTS, LAYOUTS } from '../lib/chord_map';
import type { ChordMapSettings } from '../dials';
import { CHORD_MAP_PLAY, CHORD_MAP_POINTS, MELODY_NOTES, type ChordMapDialParams } from '../nodes/chord_map';
import { PLAYER_HANDS } from '@thoremin/sdk/nodes/player_hands';

const PLAY_LABEL: Record<ChordMapDialParams['play'], string> = {
  hold: 'hold the chord, melody with the other hand',
  strum: 'strum it with the other hand',
};
const HAND_LABEL: Record<ChordMapDialParams['chordHand'], string> = {
  left: 'left hand points at chords',
  right: 'right hand points at chords',
};
const MELODY_NOTES_LABEL: Record<ChordMapDialParams['melodyNotes'], string> = {
  chord: "the chord's tones",
  pentatonic: 'the pentatonic',
  scale: 'the whole scale',
  tilt: 'chosen by tilting the hand',
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
  const c = (state.effective.chordMap ?? {}) as Partial<ChordMapSettings>;
  const enabled = c.enabled === true;
  const layout = c.layout ?? 'harmonic';
  const anchor = c.anchor ?? 'home';
  const gridOnVideo = c.gridOnVideo?.show ?? true;
  const follow = c.follow ?? 'hands';
  const chordsFrom = c.chordsFrom ?? 'key';
  const clock = c.clock ?? 'tempo';
  const commit = c.commit ?? 'now';
  const commitBeats = c.commitBeats ?? 1;
  const play = c.play ?? 'hold';
  const chordHand = c.chordHand ?? 'left';
  const point = c.point ?? 'palm';
  const split = c.split ?? 0.65;
  const cellSize = c.cellSize ?? 0.2;
  const melody = c.melody ?? true;
  const melodyVolume = c.melodyVolume ?? 0.45;
  const volume = c.volume ?? 0.7;
  const captions = c.captions ?? true;
  const melodyNotes = c.melodyNotes ?? 'chord';
  const sevenths = c.sevenths ?? false;
  const face = c.face ?? false;
  const faceMode = c.faceMode ?? true;
  const faceTension = c.faceTension ?? true;
  const modeDwellS = c.modeDwellS ?? 1;
  const faceFromRest = c.faceFromRest ?? true;
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
      <label className="flex items-center justify-between gap-2 text-xs" title="With a pentatonic the map can lay out the scale's own five chords, stacks of its own thirds (C6, Gsus4, Asus4, C, Dsus4 in C), instead of its key's seven; the letters map and seventh chords apply to seven-chord maps only. A harmonic minor's own chords are its key's (i, ii°, III+, iv, V, VI, vii°); any other scale keeps its key's seven.">
        Chords
        <select className={selectCls} value={chordsFrom} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.chordsFrom', e.target.value)}>
          <option value="key">the key's seven</option>
          <option value="scale">the scale's own</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="A MIDI keyboard, the microphone or your signs can choose the chords: what is played (or the letter fingerspelled: A to G, the chord of the key on that letter) lights up on the map, and your hands play the melody over it or strum it. A keyboard or the microphone asks the browser for access when chosen; signs need the Sign language section on.">
        Chords from
        <select className={selectCls} value={follow} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.follow', e.target.value)}>
          <option value="hands">your pointing hand</option>
          <option value="midi">a MIDI keyboard</option>
          <option value="audio">the microphone (a guitar, a piano, a band)</option>
          <option value="signs">signed letters A to G (Sign language on)</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="Letters: the map stays put across keys. A minor is home on the A chords (vi's place in C), and a change of key lights up the chords it changes (C to G: ii, IV and vii°). For a seven-chord map (not a pentatonic's own chords).">
        Map
        <select className={selectCls} value={anchor} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.anchor', e.target.value)}>
          <option value="home">the key's home in the middle</option>
          <option value="letters">the seven letters stay put</option>
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
        <label className="flex items-center justify-between gap-2 text-xs" title="Tilt: hold the melody hand upright for the chord's tones, tilt it for the pentatonic, tilt it further for the whole scale (the video's right hand).">
          Melody notes
          <select className={selectCls} value={melodyNotes} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.melodyNotes', e.target.value)}>
            {MELODY_NOTES.map((m) => (
              <option key={m} value={m}>
                {MELODY_NOTES_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      )}
      {play === 'hold' && melody && (
        <Range label={`Melody volume (${Math.round(melodyVolume * 100)}%)`} path="chordMap.melodyVolume" value={melodyVolume} min={0} max={1} step={0.05} enabled={enabled} />
      )}
      <label className="flex items-center gap-2 text-xs" title="The chords and the melody ladder drawn over the video. Off, the map still plays where it would be drawn.">
        <input type="checkbox" checked={gridOnVideo} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.gridOnVideo.show', e.target.checked)} />
        Draw the map on the video
      </label>
      <label className="flex items-center gap-2 text-xs" title="The key's seventh chords: Cmaj7, Dm7, G7, Bø7. Neighbours a third apart then share three notes.">
        <input type="checkbox" checked={sevenths} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.sevenths', e.target.checked)} />
        Seventh chords
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="The beat the arpeggios step on and a change waits for: the Chord sound's tempo, or the song loaded in the Song tool while it plays.">
        Keep time with
        <select className={selectCls} value={clock} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.clock', e.target.value)}>
          <option value="tempo">the Chord sound's tempo</option>
          <option value="song">the song</option>
          <option value="conductor">the conductor (while conducting)</option>
        </select>
      </label>
      {play === 'hold' && (
        <label className="flex items-center justify-between gap-2 text-xs" title="On the beat: a new chord waits for the next beat (one made just after a beat takes it), so changes land where the music wants them rather than when the camera saw your hand.">
          A new chord sounds
          <select className={selectCls} value={commit === 'beat' ? `beat${commitBeats}` : 'now'} disabled={!enabled} onChange={(e) => dispatchDialPatch(e.target.value === 'now' ? [['chordMap.commit', 'now']] : [['chordMap.commit', 'beat'], ['chordMap.commitBeats', Number(e.target.value.slice(4))]])}>
            <option value="now">at once</option>
            <option value="beat1">on the next beat</option>
            <option value="beat2">on the next half bar (2 beats)</option>
            <option value="beat4">on the next bar (4 beats)</option>
          </select>
        </label>
      )}
      {play === 'strum' && <Range label={`Strum volume (${Math.round(volume * 100)}%)`} path="chordMap.volume" value={volume} min={0} max={1} step={0.05} enabled={enabled} />}
      <label className="flex items-center gap-2 text-xs" title="Your face colours the chords your hands choose: it never chooses one.">
        <input type="checkbox" checked={face} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.face', e.target.checked)} />
        The face colours the chords
      </label>
      {face && (
        <div className="space-y-1 pl-5">
          <label className="flex items-center gap-2 text-xs" title="A smile held a moment turns the key to its parallel major, a frown to its parallel minor; a neutral face plays the key as set.">
            <input type="checkbox" checked={faceMode} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.faceMode', e.target.checked)} />
            Smile for major, frown for minor
          </label>
          <label className="flex items-center gap-2 text-xs" title="Learn your face at rest as you play (a few calm seconds) and read only what rises above it, so brows that rest high or a furrow from the lighting count for nothing. Off: fixed levels.">
            <input type="checkbox" checked={faceFromRest} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.faceFromRest', e.target.checked)} />
            Read my face from its own rest
          </label>
          <Range label={`Hold a smile or frown ${modeDwellS.toFixed(1)} s to change the key`} path="chordMap.modeDwellS" value={modeDwellS} min={0} max={4} step={0.1} enabled={enabled && faceMode} />
          {play === 'hold' && (
            <label className="flex items-center gap-2 text-xs" title="An open mouth with raised brows adds the key's seventh, then its ninth, to the chord your hands hold (a strum plays the guitar's chord).">
              <input type="checkbox" checked={faceTension} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordMap.faceTension', e.target.checked)} />
              Open mouth, raised brows: richer chords
            </label>
          )}
        </div>
      )}
    </div>
  );
}
