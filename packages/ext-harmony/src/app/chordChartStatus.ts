/**
 * chordChartStatus: the live chord-chart state the engine loop reports, for its settings section
 * (the chord in force, the next one, whether the conductor's beat runs). The `chordWheelStatus`
 * pattern: the DAG produces it, React only displays it.
 */
import { createStatusStore, type StatusState } from '@thoremin/sdk-ui/statusStore';
import { IDLE_CHORD_CHART_STATUS, type ChordChartStatus } from '../nodes/chord_chart';

export const CHORD_CHART_NODE_ID = 'chordChart';

export type ChordChartStatusState = StatusState<ChordChartStatus, 'live'>;

/** What to tell the player, per state. */
export function describeChordChartLive(live: ChordChartStatus): string {
  if (!live.enabled) return 'Off. Tick "Play the chord chart" (the Conduct the Chords instrument has it on).';
  if (!live.conducting && !live.hasChart) return 'Turn conducting on in the Conductor tool and choose a piece: it is read beat by beat for its chords.';
  if (!live.hasChart) return 'No chords in this piece yet: choose another in the Conductor tool.';
  if (!live.conducting) return `${live.changes} chord changes. Turn conducting on in the Conductor tool to play them.`;
  if (!live.running) return `${live.changes} chord changes. Conduct: the chart starts on your downbeat.`;
  return `${live.chord ?? ''}${live.next ? `, then ${live.next}` : ''}.`;
}

export function chordChartLiveKey(l: ChordChartStatus): string {
  return [l.enabled ? 1 : 0, l.hasChart ? 1 : 0, l.changes, l.running ? 1 : 0, l.conducting ? 1 : 0, l.chord ?? '-', l.next ?? '-'].join('|');
}

/** The chord chart's readout store, reporter and status hook (the shared readout store, #969). */
export const CHORD_CHART_STATUS = createStatusStore(CHORD_CHART_NODE_ID, { absent: IDLE_CHORD_CHART_STATUS, keyOf: chordChartLiveKey, field: 'live' });

export const useChordChartStatus = CHORD_CHART_STATUS.useStatus;

/** The per-frame sink over the chord chart node (to this store by default). */
export const makeChordChartReporter = CHORD_CHART_STATUS.makeReporter;
