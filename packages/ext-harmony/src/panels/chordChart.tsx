/**
 * The chord chart's settings section (H9 of #613): on/off, how much of the piece is read as one
 * chord, and the live readout (the chord in force, the next). The piece is the Conductor tool's;
 * the sound, voicing and figuration are the instrument's Chord sound settings. Every control
 * writes through `dispatchDialSetIn` (the single write path).
 */
import { dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { describeChordChartLive, useChordChartStatus } from '../app/chordChartStatus';
import type { ChordChartDialParams } from '../nodes/chord_chart';

export function ChordChartReadout() {
  const live = useChordChartStatus((s) => s.live);
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs" data-testid="chord-chart-live" data-state={live.enabled ? (live.running ? 'playing' : 'ready') : 'off'}>
      <span className="text-white/80">{describeChordChartLive(live)}</span>
    </div>
  );
}

export function ChordChartControls() {
  const { state } = useDialsSettings();
  const c = (state.effective.chordChart ?? {}) as Partial<ChordChartDialParams>;
  const enabled = c.enabled === true;
  const step = c.step ?? 1;
  return (
    <div className="space-y-2" data-testid="chord-chart-controls">
      <ChordChartReadout />
      <p className="text-[10px] leading-relaxed text-white/50">
        The piece you conduct, read for its chords beat by beat, played by your beat: the chord sounds voice-led, its arpeggio steps on your beats, and it holds through a fermata. Choose the piece and start conducting in the Conductor tool; the sound is the Chord sound section's.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => dispatchDialSetIn('chordChart.enabled', e.target.checked)} />
        Play the chord chart
      </label>
      <label className="flex items-center justify-between gap-2 text-xs" title="How much of the piece is read as one chord: a fast harmony wants every beat, a slow one a bar.">
        A chord every
        <select className={selectCls} value={step} disabled={!enabled} onChange={(e) => dispatchDialSetIn('chordChart.step', Number(e.target.value))}>
          <option value={1}>beat</option>
          <option value={2}>2 beats</option>
          <option value={4}>bar (4 beats)</option>
        </select>
      </label>
    </div>
  );
}
