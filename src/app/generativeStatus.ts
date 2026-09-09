/**
 * generativeStatus — a tiny store the engine loop writes the live `lyria` status
 * into, so the Generative settings section can render an honest readout (#188):
 * off / loading / ready / active, or `unavailable` with the reason (`no-key`) a
 * panel turns into a key prompt. Ephemeral per-frame runtime state, exactly like
 * `midiStatus` and `faceStatus` — the DAG produces it; React only displays it.
 *
 * {@link makeGenerativeReporter} is the per-frame sink the host loop registers
 * beside `reportMidi` in `useEngine.ts`: it reads the node's `status` output and
 * reports it only when something changed, so the panel never re-renders 60×/s for
 * an unchanged phase.
 */
import { create } from 'zustand';
import type { LoadStatus } from '@/lazy';

/** The status before the engine has reported anything (or after teardown). */
export const ABSENT_GENERATIVE_STATUS: LoadStatus = { phase: 'off', message: 'Generative layer off' };

/** The node id the reporter reads — the `lyria` node in `graph.ts`. */
export const GENERATIVE_NODE_ID = 'gen';

export interface GenerativeStatusState {
  status: LoadStatus;
  report(status: LoadStatus): void;
  reset(): void;
}

export const useGenerativeStatus = create<GenerativeStatusState>((set) => ({
  status: ABSENT_GENERATIVE_STATUS,
  report: (status) => set({ status }),
  reset: () => set({ status: ABSENT_GENERATIVE_STATUS }),
}));

/** The one thing the reporter needs from an engine: a node output read. */
export interface OutputReader {
  getOutput(nodeId: string, port: string): unknown;
}

/**
 * Build the per-frame sink: read `gen.status`, report it to {@link useGenerativeStatus}
 * when its phase / reason / message / progress changed. Pure over the reader, so it is
 * testable with a stub engine.
 */
export function makeGenerativeReporter(
  engine: OutputReader,
  store: Pick<GenerativeStatusState, 'report'> = useGenerativeStatus.getState(),
  nodeId: string = GENERATIVE_NODE_ID,
): () => void {
  let lastKey = '';
  return () => {
    const s = engine.getOutput(nodeId, 'status') as LoadStatus | undefined;
    if (!s) return;
    const key = `${s.phase}|${s.reason ?? ''}|${s.message}|${s.progress ?? ''}`;
    if (key === lastKey) return;
    lastKey = key;
    store.report(s);
  };
}
