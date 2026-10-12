/**
 * The sign reader's live state for the React side: the named sign and the models' load
 * status, mirrored from the `aslSigns` node each tick (only when it changes).
 */
import { create } from 'zustand';
import type { LoadStatus } from '@thoremin/lazy';
import type { SignScores } from '@thoremin/asl';
import { signText } from '@thoremin/asl';
import { ASL_SIGNS_NODE_ID } from '../branches';

export interface AslLive {
  present: boolean;
  /** The named sign, written out ("THANK YOU"), or null. */
  text: string | null;
  confidence: number;
  status: LoadStatus | null;
}

export const ABSENT_ASL_LIVE: AslLive = { present: false, text: null, confidence: 0, status: null };

interface AslStatusState {
  live: AslLive;
  report: (l: AslLive) => void;
  reset: () => void;
}

export const useAslStatus = create<AslStatusState>((set) => ({
  live: ABSENT_ASL_LIVE,
  report: (live) => set({ live }),
  reset: () => set({ live: ABSENT_ASL_LIVE }),
}));

/** The one thing the reporter reads (the engine, or a test double). Declared here, not
 *  imported from the React-typed `sdk-ui/types`, so this module stays strict-checkable. */
export interface OutputReader {
  getOutput(nodeId: string, port: string): unknown;
}

export function makeAslReporter(engine: OutputReader, store: Pick<AslStatusState, 'report'> = useAslStatus.getState()): () => void {
  let lastKey = '';
  return () => {
    const r = engine.getOutput(ASL_SIGNS_NODE_ID, 'reading') as SignScores | undefined;
    const status = (engine.getOutput(ASL_SIGNS_NODE_ID, 'status') as LoadStatus | undefined) ?? null;
    if (!r) return;
    const i = r.label ? r.labels.indexOf(r.label) : -1;
    const live: AslLive = {
      present: r.present,
      text: r.label ? signText(r.label) : null,
      confidence: i >= 0 ? Math.round((r.scores[i] ?? 0) * 20) / 20 : 0,
      status,
    };
    const key = `${live.present}|${live.text}|${live.confidence}|${status?.phase}|${status?.message}`;
    if (key === lastKey) return;
    lastKey = key;
    store.report(live);
  };
}
