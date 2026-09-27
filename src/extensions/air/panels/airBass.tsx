/**
 * The AIR BASS section of the settings panel (#249): the fretting hand's place along an
 * imaginary neck picks the note, a pluck of the other hand sounds it. Every control
 * writes a leaf of the structured `airBass` dial through `dispatchDialSetIn` (the single
 * write path). The neck's NOTES are the instrument's own scale (the Sound section's
 * scale, root and range), so this section only says how long the neck is and which hand
 * plucks. The live readout ({@link AirBassReadout}) is shown here and under the chosen
 * row in the Instruments list.
 */
import { dispatchDialSetIn } from '@/app/dispatchDial';
import { useDialsSettings } from '@/app/dials/useDialsSettings';
import { selectCls } from '@/app/dials/primitives';
import { describeBassLive, useAirBassStatus } from '@/extensions/air/app/airBassStatus';
import { midiToName } from '@/music/theory';
import { PLAYER_HANDS, PLUCK_POINTS, type AirBassDialParams } from '@/extensions/air/nodes/air_bass';

/** The shortest neck the sliders allow, in palm spans: the highest note stays nearer the
 *  body than the lowest (equal ends would leave no neck, and crossed ones reverse it). */
const NECK_GAP = 1;

const HAND_LABEL: Record<AirBassDialParams['pluckHand'], string> = {
  right: 'right hand plucks',
  left: 'left hand plucks',
};
const POINT_LABEL: Record<AirBassDialParams['pluckPoint'], string> = {
  indexTip: 'index fingertip',
  wrist: 'wrist',
};

/** What the air bass is doing right now, from the engine loop's reporter. */
export function AirBassReadout() {
  const live = useAirBassStatus((s) => s.live);
  const share = live.notes > 0 ? Math.round((100 * live.predicted) / live.notes) : 0;
  return (
    <div
      className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs"
      data-testid="air-bass-live"
      data-state={live.enabled ? (live.notes > 0 ? 'playing' : 'ready') : 'off'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-white/80">{describeBassLive(live)}</span>
        {live.enabled && live.notes > 0 && (
          <span className="shrink-0 font-mono text-emerald-300" title="notes, and the share predicted ahead of the pluck">
            {live.notes} · {share}%
          </span>
        )}
      </div>
      {live.enabled && live.fretMidi !== null && (
        <div className="text-[10px] text-white/50">Under your fretting hand: {midiToName(live.fretMidi)}</div>
      )}
    </div>
  );
}

export function AirBassControls() {
  const { state } = useDialsSettings();
  const c = (state.effective.airBass ?? {}) as Partial<AirBassDialParams>;
  const enabled = c.enabled === true;
  const pluckHand = c.pluckHand ?? 'right';
  const pluckPoint = c.pluckPoint ?? 'indexTip';
  const neckNear = c.neckNear ?? 2;
  const neckFar = c.neckFar ?? 7;
  const volume = c.volume ?? 0.8;
  return (
    <div className="space-y-2">
      <AirBassReadout />
      <p className="text-[10px] leading-relaxed text-white/50">
        Hold an imaginary bass: one hand on the neck, the other over the strings. Slide the neck
        hand out for low notes and in toward your body for high ones; pluck down with the other
        hand to sound the note. The notes are this instrument's scale (the right voice's scale, root
        and range in the Sound section), and the arrow keys shift them by octaves.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => dispatchDialSetIn('airBass.enabled', e.target.checked)} />
        Play the air bass
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Plucking hand
        <select className={selectCls} value={pluckHand} disabled={!enabled} onChange={(e) => dispatchDialSetIn('airBass.pluckHand', e.target.value)}>
          {PLAYER_HANDS.map((h) => (
            <option key={h} value={h}>
              {HAND_LABEL[h]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Pluck point
        <select className={selectCls} value={pluckPoint} disabled={!enabled} onChange={(e) => dispatchDialSetIn('airBass.pluckPoint', e.target.value)}>
          {PLUCK_POINTS.map((pt) => (
            <option key={pt} value={pt}>
              {POINT_LABEL[pt]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="The neck hand's distance from the plucking hand, in its own palm widths, at the HIGHEST note.">
        <span>Highest note at ({neckNear.toFixed(1)} palms)</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, neckFar - NECK_GAP)}
          step={0.5}
          value={neckNear}
          disabled={!enabled}
          className="w-[45%]"
          onChange={(e) => dispatchDialSetIn('airBass.neckNear', Number(e.target.value))}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="The neck hand's distance from the plucking hand, in its own palm widths, at the LOWEST note.">
        <span>Lowest note at ({neckFar.toFixed(1)} palms)</span>
        <input
          type="range"
          min={neckNear + NECK_GAP}
          max={15}
          step={0.5}
          value={neckFar}
          disabled={!enabled}
          className="w-[45%]"
          onChange={(e) => dispatchDialSetIn('airBass.neckFar', Number(e.target.value))}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>Bass volume ({Math.round(volume * 100)}%)</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          disabled={!enabled}
          className="w-[45%]"
          onChange={(e) => dispatchDialSetIn('airBass.volume', Number(e.target.value))}
        />
      </label>
    </div>
  );
}
