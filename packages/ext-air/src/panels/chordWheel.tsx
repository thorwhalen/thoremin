/**
 * The CHORD WHEEL section of the settings panel: a next-chord wheel, the chord in force in the
 * centre and a move per wedge. Every control writes a leaf of the `chordWheel` dial through
 * `dispatchDialSetIn` (the single write path). The key is the chord-source scale and a chord
 * sounds as the Chord sound section says, as for the chord map.
 */
import { TENSION_MODEL_IDS, TENSION_MODELS } from '@thoremin/sdk/harmony/tension';
import { dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { describeChordWheelLive, useChordWheelStatus } from '../app/chordWheelStatus';
import { DEFAULT_FACE_MOVES, WHEEL_MOVES, WHEEL_MOVE_SETS, WHEEL_STEER, type ChordWheelDialParams } from '../nodes/chord_wheel';
import { RELATIONS } from '@thoremin/sdk/harmony/space';
import { EMOTIONS, type Emotion } from '@thoremin/sdk/music/expression';
import { PLAYER_HANDS } from '../nodes/air_bass';

const STEER_LABEL: Record<ChordWheelDialParams['steer'], string> = {
  hand: 'the hand (push toward a move)',
  face: 'the face (each expression a move)',
  both: 'the hand and the face',
};
const moveLabel = (id: string) => (id === 'none' ? 'no move' : (RELATIONS.get(id)?.label ?? id));

const MOVES_LABEL: Record<ChordWheelDialParams['moves'], string> = {
  diatonic: "the key's moves (fourths, thirds, seconds)",
  tonnetz: "the Tonnetz's moves (P, L, R, N, S, H)",
};

export function ChordWheelReadout() {
  const live = useChordWheelStatus((s) => s.live);
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs" data-testid="chord-wheel-live" data-state={live.enabled ? (live.chord ? 'playing' : 'ready') : 'off'}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-white/80">{describeChordWheelLive(live)}</span>
        {live.enabled && live.moveCount > 0 && (
          <span className="shrink-0 font-mono text-emerald-300" title="moves made">
            {live.moveCount}
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

export function ChordWheelControls() {
  const { state } = useDialsSettings();
  const c = (state.effective.chordWheel ?? {}) as Partial<ChordWheelDialParams>;
  const enabled = c.enabled === true;
  const moves = c.moves ?? 'diatonic';
  const hand = c.hand ?? 'left';
  const radius = c.radius ?? 0.3;
  const reach = c.reach ?? 0.14;
  const enterFrames = c.enterFrames ?? 3;
  const steer = c.steer ?? 'hand';
  const faceMoves = (c.faceMoves ?? {}) as Partial<Record<Emotion, string>>;
  const walk = c.walk ?? false;
  const tension = c.tension ?? 'off';
  const order = c.order ?? 'fixed';
  const walkBeats = c.walkBeats ?? 1;
  return (
    <div className="space-y-2" data-testid="chord-wheel-controls">
      <ChordWheelReadout />
      <p className="text-[10px] leading-relaxed text-white/50">
        The chord in force sits in the middle of the wheel, and each wedge around it is one move, always at the same place. Hold your palm over the middle, push toward a move and hold it: the move is made, the wheel turns to the new chord, and you come back to the middle for the next one. The key's moves stay in the key; the Tonnetz's (parallel, relative, leading-tone and their compounds) leave it.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => dispatchDialSetIn('chordWheel.enabled', e.target.checked)} />
        Play the chord wheel
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Moves
        <select className={selectCls} value={moves} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordWheel.moves', e.target.value)}>
          {WHEEL_MOVE_SETS.map((m) => (
            <option key={m} value={m}>
              {MOVES_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Steer with
        <select className={selectCls} value={steer} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordWheel.steer', e.target.value)}>
          {WHEEL_STEER.map((st) => (
            <option key={st} value={st}>
              {STEER_LABEL[st]}
            </option>
          ))}
        </select>
      </label>
      {steer !== 'hand' && (
        <div className="space-y-1 rounded border border-white/10 p-1.5" data-testid="chord-wheel-face-moves">
          <p className="text-[10px] text-white/50">Each expression, held a moment, makes one move; a neutral face gets ready for the next.</p>
          {EMOTIONS.map((e) => (
            <label key={e} className="flex items-center justify-between gap-2 text-xs">
              {e}
              <select className={selectCls} value={faceMoves[e] ?? ''} disabled={!enabled} onChange={(ev) => dispatchDialSetIn(`chordWheel.faceMoves.${e}`, ev.target.value)}>
                <option value="">default ({moveLabel(DEFAULT_FACE_MOVES[moves][e])})</option>
                <option value="none">no move</option>
                {WHEEL_MOVES[moves].map((m) => (
                  <option key={m} value={m}>
                    {moveLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <label className="flex items-center justify-between gap-2 text-xs">
        Steering hand
        <select className={selectCls} value={hand} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordWheel.hand', e.target.value)}>
          {PLAYER_HANDS.map((h) => (
            <option key={h} value={h}>
              {h === 'left' ? 'left hand' : 'right hand'}
            </option>
          ))}
        </select>
      </label>
      <Range label={`Wheel size (${Math.round(radius * 100)}% of the height)`} path="chordWheel.radius" value={radius} min={0.15} max={0.45} step={0.01} enabled={enabled} />
      <Range label={`Push to choose (${Math.round(reach * 100)}% of the height)`} path="chordWheel.reach" value={reach} min={0.05} max={0.4} step={0.01} enabled={enabled} title="How far from the middle the hand must reach for a move." />
      <Range label={`Hold for (${enterFrames} frames)`} path="chordWheel.enterFrames" value={enterFrames} min={1} max={15} step={1} enabled={enabled} title="How long the hand must stay on a move before it is made." />
      <label className="flex items-center gap-2 text-xs" title="Hold a push out and the wheel keeps making that move on the beat the Chord sound plays: a fourth walks all seven chords of the key. On the Tonnetz wheel each move undoes itself, so a held one swings between two chords.">
        <input type="checkbox" checked={walk} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordWheel.walk', e.target.checked)} />
        Hold a push to walk it on the beat
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="Likeliest on top: the key's moves ranked from the chord in force by Piston's table of usual root progressions, so the wheel turns as the chord changes (pushing up from C plays I, IV, V, I). A held walk keeps the order it started with.">
        Where each move sits
        <select className={selectCls} value={order} disabled={!enabled || moves !== 'diatonic'} onChange={(e) => dispatchDialSetIn('chordWheel.order', e.target.value)}>
          <option value="fixed">always the same place</option>
          <option value="likely">likeliest next chord on top</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="Each chord's tension under its name, by the model named over the wheel. The models disagree (the functional ladder makes V tenser than ii; Lerdahl's distance and the key profile put ii further from home), so a number always comes with its model.">
        Tension shown
        <select className={selectCls} value={tension} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordWheel.tension', e.target.value)}>
          <option value="off">none</option>
          {TENSION_MODEL_IDS.map((m) => (
            <option key={m} value={m}>
              {TENSION_MODELS[m].name}
            </option>
          ))}
        </select>
      </label>
      {walk && (
        <label className="flex items-center justify-between gap-2 text-xs">
          A step every
          <select className={selectCls} value={walkBeats} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordWheel.walkBeats', Number(e.target.value))}>
            {[1, 2, 3, 4].map((b) => (
              <option key={b} value={b}>
                {b === 1 ? 'beat' : `${b} beats`}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
