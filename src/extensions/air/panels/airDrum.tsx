/**
 * The AIR DRUM section of the settings panel (#233): strike the air, hear a drum at
 * the strike. Off by default; the toggle, the hand and point choosers, the two drum
 * sounds and the two sliders all write leaves of the structured `airDrum` dial through
 * `dispatchDialSetIn` (the single write path). The sliders dispatch on every notch
 * (a few steps each), the accepted trade for staying on the write path.
 *
 * Since #249 the air drum is an INSTRUMENT, not a tool: it is chosen from the Air
 * instruments category of the Instruments view, and this section (in that view's
 * editor) is its one home. So it carries the live readout the retired tool panel had —
 * floors learned, hits, the last hit's lead — as {@link AirDrumReadout}, which the
 * instrument's row in the list shows too.
 */
import { dispatchDialSetIn } from '@/app/dispatchDial';
import { useDialsSettings } from '@/app/dials/useDialsSettings';
import { selectCls } from '@/app/dials/primitives';
import { describeLive, useAirDrumStatus } from '@/extensions/air/app/airDrumStatus';
import { DrumPadEditor } from '@/extensions/air/panels/airDrumPads';
import { useEffect, useState } from 'react';
import { PatternTrainer } from '@/extensions/air/app/PatternTrainer';
import { trainedPatternIds, usePatternModelsVersion } from '@/extensions/air/app/patternModels';
import { DRUM_PATTERNS } from '@thoremin/sdk/music/drum_patterns';
import { AIR_DRUM_HANDS, AIR_DRUM_POINTS, DRUM_SOUNDS, type AirDrumDialParams } from '@/extensions/air/nodes/air_drum';

const HAND_LABEL: Record<AirDrumDialParams['hand'], string> = {
  both: 'both hands',
  right: 'right hand only',
  left: 'left hand only',
};
const POINT_LABEL: Record<AirDrumDialParams['point'], string> = {
  wrist: 'wrist (steady)',
  indexTip: 'index fingertip',
  stickTip: 'stick tip (a stick extended from the grip)',
};
const SOUND_LABEL: Record<AirDrumDialParams['rightSound'], string> = {
  kick: 'kick',
  snare: 'snare',
  hihat: 'hi-hat',
  tom: 'tom',
  crash: 'crash',
  ride: 'ride',
};

/** What the air drum is doing right now, from the engine loop's reporter. */
export function AirDrumReadout() {
  const live = useAirDrumStatus((s) => s.live);
  const share = live.hits > 0 ? Math.round((100 * live.predicted) / live.hits) : 0;
  return (
    <div
      className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs"
      data-testid="air-drum-live"
      data-state={live.enabled ? (live.hits > 0 ? 'playing' : 'ready') : 'off'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-white/80">{describeLive(live)}</span>
        {live.enabled && live.hits > 0 && (
          <span className="shrink-0 font-mono text-emerald-300" title="hits, and the share predicted ahead of the strike">
            {live.hits} · {share}%
          </span>
        )}
      </div>
      {live.enabled && (
        <div className="flex gap-3 text-[10px] text-white/50">
          <span>Right drum: {live.ready.right ? 'learned' : 'strike once'}</span>
          <span>Left drum: {live.ready.left ? 'learned' : 'strike once'}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The pattern mode (#269): play a trained pattern, and what you play is snapped to its
 * grid at your tempo with your feel kept. Only patterns with a model are offered; the
 * dial keeps the id, the app resolves it to the pattern and model for the node.
 */
function PatternModeSelect({ value, enabled }: { value: string; enabled: boolean }) {
  const [trained, setTrained] = useState<string[]>([]);
  // Re-read when a take trains or forgets a pattern, so what was just trained is offered.
  const version = usePatternModelsVersion((s) => s.version);
  useEffect(() => {
    let live = true;
    void trainedPatternIds()
      .then((ids) => live && setTrained(ids))
      .catch(() => live && setTrained([]));
    return () => {
      live = false;
    };
  }, [value, version]);
  const options = DRUM_PATTERNS.filter((p) => trained.includes(p.id) || p.id === value);
  return (
    <label
      className="flex items-center justify-between gap-2 text-xs"
      title="With a pattern in play, each hit is snapped to the pattern's grid at your running tempo, with the feel you trained, and sounds as the pattern's drum there (the drum of the pad you struck when the pattern has it near). A pause of more than a bar starts the pattern over on your next hit."
    >
      <span>Play pattern</span>
      <select className={selectCls} value={value} disabled={!enabled} aria-label="Play pattern" onChange={(e) => dispatchDialSetIn('airDrum.pattern', e.target.value)}>
        <option value="">off (play freely)</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {trained.includes(p.id) ? '' : ' (not trained yet)'}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AirDrumControls() {
  const { state } = useDialsSettings();
  const c = (state.effective.airDrum ?? {}) as Partial<AirDrumDialParams> & { pattern?: string };
  const enabled = c.enabled === true;
  const pattern = c.pattern ?? '';
  const hand = c.hand ?? 'both';
  const point = c.point ?? 'stickTip';
  const rightSound = c.rightSound ?? 'kick';
  const leftSound = c.leftSound ?? 'snare';
  const minLead = c.minLead ?? 0.05;
  const magnetism = c.magnetism ?? 0;
  return (
    <div className="space-y-2">
      <AirDrumReadout />
      <p className="text-[10px] leading-relaxed text-white/50">
        Strike down in front of the camera as if hitting a drum. The first strike of each hand
        teaches the instrument where that drum is; from then on the hit sounds at the strike,
        predicted from the stroke before the camera has even seen it land. Faster strokes are louder.
      </p>
      <PatternTrainer enabled={enabled} />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => dispatchDialSetIn('airDrum.enabled', e.target.checked)} />
        Drum in the air
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Drumming hands
        <select className={selectCls} value={hand} disabled={!enabled} onChange={(e) => dispatchDialSetIn('airDrum.hand', e.target.value)}>
          {AIR_DRUM_HANDS.map((h) => (
            <option key={h} value={h}>
              {HAND_LABEL[h]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Stick point
        <select className={selectCls} value={point} disabled={!enabled} onChange={(e) => dispatchDialSetIn('airDrum.point', e.target.value)}>
          {AIR_DRUM_POINTS.map((pt) => (
            <option key={pt} value={pt}>
              {POINT_LABEL[pt]}
            </option>
          ))}
        </select>
      </label>
      {(['right', 'left'] as const).map((side) => (
        <label key={side} className="flex items-center justify-between gap-2 text-xs">
          {side === 'right' ? 'Right hand plays' : 'Left hand plays'}
          <select
            className={selectCls}
            value={side === 'right' ? rightSound : leftSound}
            disabled={!enabled}
            onChange={(e) => dispatchDialSetIn(side === 'right' ? 'airDrum.rightSound' : 'airDrum.leftSound', e.target.value)}
          >
            {DRUM_SOUNDS.map((s) => (
              <option key={s} value={s}>
                {SOUND_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      ))}
      <DrumPadEditor enabled={enabled} />
      <label className="flex items-center justify-between gap-2 text-xs" title="How far ahead of the strike a hit is committed, from the moment the app decides (the camera's delay is added on top): your audio output latency plus a margin. Too late and the hit sounds a frame after the strike.">
        <span>Lead ({Math.round(minLead * 1000)} ms)</span>
        <input
          type="range"
          min={0}
          max={0.2}
          step={0.01}
          value={minLead}
          disabled={!enabled}
          className="w-[55%]"
          onChange={(e) => dispatchDialSetIn('airDrum.minLead', Number(e.target.value))}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="With the conductor on: how far a hit is pulled toward the expected beat (0 = exactly when you struck, 1 = onto the beat).">
        <span>Timing magnetism ({magnetism.toFixed(1)})</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={magnetism}
          disabled={!enabled}
          className="w-[55%]"
          onChange={(e) => dispatchDialSetIn('airDrum.magnetism', Number(e.target.value))}
        />
      </label>
      <PatternModeSelect value={pattern} enabled={enabled} />
    </div>
  );
}
