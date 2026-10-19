/**
 * The CHORD WHEEL section of the settings panel: a next-chord wheel, the chord in force in the
 * centre and a move per wedge. Every control writes a leaf of the `chordWheel` dial through
 * `dispatchDialSetIn` (the single write path). The key is the chord-source scale and a chord
 * sounds as the Chord sound section says, as for the chord map.
 */
import { dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { describeChordWheelLive, useChordWheelStatus } from '../app/chordWheelStatus';
import { WHEEL_MOVE_SETS, type ChordWheelDialParams } from '../nodes/chord_wheel';
import { PLAYER_HANDS } from '../nodes/air_bass';

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
    </div>
  );
}
