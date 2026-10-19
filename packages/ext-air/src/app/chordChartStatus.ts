/**
 * chordChartStatus: the live chord-chart state the engine loop reports, for its settings section
 * (the chord in force, the next one, whether the conductor's beat runs). The `chordWheelStatus`
 * pattern: the DAG produces it, React only displays it.
 */
import { create } from 'zustand';
import { IDLE_CHORD_CHART_STATUS, type ChordChartStatus } from '../nodes/chord_chart';

export const CHORD_CHART_NODE_ID = 'chordChart';

export interface ChordChartStatusState {
  live: ChordChartStatus;
  report(live: ChordChartStatus): void;
  reset(): void;
}

export const useChordChartStatus = create<ChordChartStatusState>((set) => ({
  live: IDLE_CHORD_CHART_STATUS,
  report: (live) => set({ live }),
  reset: () => set({ live: IDLE_CHORD_CHART_STATUS }),
}));

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

export function makeChordChartReporter(engine: { getOutput(nodeId: string, port: string): unknown }, store: Pick<ChordChartStatusState, 'report'> = useChordChartStatus.getState()): () => void {
  let lastKey = '';
  return () => {
    const status = engine.getOutput(CHORD_CHART_NODE_ID, 'status') as ChordChartStatus | undefined;
    if (!status) return;
    const key = chordChartLiveKey(status);
    if (key === lastKey) return;
    lastKey = key;
    store.report(status);
  };
}
