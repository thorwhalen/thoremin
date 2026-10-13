/**
 * timingStatus — a tiny store the engine loop writes the timing resource's reading into
 * (step 0 of the timing plan), so the shell's camera status line can show the player
 * what the pipeline is doing: the delivered camera rate, how many frames carry a real
 * capture stamp, the frame's age, the audio output stage and whether it is known, and
 * an interrupted audio route. Ephemeral runtime state, like `faceStatus`: the resource
 * produces it; React only displays it.
 *
 * {@link makeTimingReporter} is the per-frame sink the host loop registers beside the
 * other bridges in `useEngine.ts`: paced to {@link TIMING_REPORT_MS} and change-gated
 * on what the line shows, so the chip never re-renders at frame rate.
 */
import { create } from 'zustand';
import type { TimingReading } from '@thoremin/sdk/timing/tracker';
import { describeTiming } from './timing/describe';

/** How often the readout may change, ms. */
export const TIMING_REPORT_MS = 500;

export interface TimingStatusState {
  reading: TimingReading | null;
  report(reading: TimingReading): void;
  reset(): void;
}

export const useTimingStatus = create<TimingStatusState>((set) => ({
  reading: null,
  report: (reading) => set({ reading }),
  reset: () => set({ reading: null }),
}));

/** What the chip shows, as a key: a report happens only when this changes. */
export function timingStatusKey(r: TimingReading): string {
  const d = describeTiming(r);
  return `${d.line}|${d.warnings.join(';')}|${r.audioEpoch}`;
}

export function makeTimingReporter(reading: () => TimingReading, store: Pick<TimingStatusState, 'report'> = useTimingStatus.getState()): (nowMs: number) => void {
  let lastKey = '';
  let lastReport = -Infinity;
  return (nowMs) => {
    if (nowMs - lastReport < TIMING_REPORT_MS) return;
    const r = reading();
    const key = timingStatusKey(r);
    if (key === lastKey) return;
    lastKey = key;
    lastReport = nowMs;
    store.report(r);
  };
}
