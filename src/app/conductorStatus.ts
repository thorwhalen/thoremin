/**
 * conductorStatus — a tiny store the engine loop writes the live conductor state
 * into (#187 PR 4), so the Conductor tool panel can show what the follower is doing:
 * ready / running / hold, the tempo it is advancing at, where in the bar it is, how
 * confident it is, and the dynamics. Ephemeral per-frame runtime state, exactly like
 * `generativeStatus` and `midiStatus` — the DAG produces it; React only displays it.
 *
 * {@link makeConductorReporter} is the per-frame sink the host loop registers beside
 * the other bridges in `useEngine.ts`: it reads the `conductor` node's `time`,
 * `dynamics` and `enabled` outputs and reports only when something a player can SEE
 * changed (the state, the whole beat, the tempo to the bpm, the confidence and
 * dynamics to a twentieth), so the panel never re-renders 60×/s for a phase that
 * merely crept.
 */
import { create } from 'zustand';
import { type DanceLeadMode, type MusicalTime, type ServoMode, type ServoState } from '@thoremin/ictus';
import type { ConductorTransportReading } from '@/nodes/features/conductor';

export interface ConductorLive {
  enabled: boolean;
  state: MusicalTime['state'];
  /** Beats per minute the score is advancing at (0 in hold / before the first stroke). */
  tempo: number;
  /** Whole beats since the start. */
  beat: number;
  beatInBar: number;
  beatsPerBar: number;
  /** 0..1. */
  confidence: number;
  /** 0..1. */
  dynamics: number;
  /** Anchors (strokes) the follower has accepted. */
  anchors: number;
  /** The recording the beat leads (#187 PR 7), while it leads one: what the song's servo
   *  is doing, the rate it plays at and how far it is from the beat (beats, + = ahead). */
  recording?: { mode: ServoMode; rate: number; error: number } | null;
  /** The body's transport (#377): what the pose rules say (`off` reading the hands). */
  transport?: ConductorTransportReading;
  /** A dancer leading (#380): what the dance lead is doing (absent otherwise). */
  dance?: DanceLeadMode;
}

export const ABSENT_CONDUCTOR_LIVE: ConductorLive = {
  enabled: false,
  state: 'ready',
  tempo: 0,
  beat: 0,
  beatInBar: 0,
  beatsPerBar: 4,
  confidence: 0,
  dynamics: 0,
  anchors: 0,
  recording: null,
  transport: 'off',
};

/** The node id the reporter reads — the `conductor` node in `graph.ts`. */
export const CONDUCTOR_NODE_ID = 'conductor';
/** The song's pace controller (the `song-pace` branch), which the conductor leads while
 *  he conducts the recording (#187 PR 7). */
export const SONG_LEAD_NODE_ID = 'pace';

export interface ConductorStatusState {
  live: ConductorLive;
  report(live: ConductorLive): void;
  reset(): void;
}

export const useConductorStatus = create<ConductorStatusState>((set) => ({
  live: ABSENT_CONDUCTOR_LIVE,
  report: (live) => set({ live }),
  reset: () => set({ live: ABSENT_CONDUCTOR_LIVE }),
}));

/** The one thing the reporter needs from an engine: a node output read. */
export interface OutputReader {
  getOutput(nodeId: string, port: string): unknown;
}

/** Quantise what the panel shows, so the change gate compares what a player sees. */
export function conductorLiveKey(l: ConductorLive): string {
  return `${l.enabled ? 1 : 0}|${l.state}|${Math.round(l.tempo)}|${l.beat}|${l.beatInBar}|${l.beatsPerBar}|${Math.round(l.confidence * 20)}|${Math.round(l.dynamics * 20)}|${l.anchors}|${l.recording ? `${l.recording.mode}:${Math.round(l.recording.rate * 100)}:${Math.round(l.recording.error * 20)}` : '-'}|${l.transport ?? 'off'}|${l.dance ?? '-'}`;
}

/**
 * Build the per-frame sink: read the conductor node's outputs, report them to
 * {@link useConductorStatus} when something visible changed. Pure over the reader, so
 * it is testable with a stub engine.
 */
export function makeConductorReporter(
  engine: OutputReader,
  store: Pick<ConductorStatusState, 'report'> = useConductorStatus.getState(),
  nodeId: string = CONDUCTOR_NODE_ID,
): () => void {
  let lastKey = '';
  return () => {
    const time = engine.getOutput(nodeId, 'time') as MusicalTime | undefined;
    if (!time) return;
    const dynamics = engine.getOutput(nodeId, 'dynamics');
    const enabled = engine.getOutput(nodeId, 'enabled');
    const live: ConductorLive = {
      enabled: enabled === true,
      state: time.state,
      tempo: Number.isFinite(time.tempo) ? time.tempo : 0,
      beat: Math.floor(time.beat),
      beatInBar: time.beatInBar,
      beatsPerBar: time.beatsPerBar,
      confidence: time.confidence,
      dynamics: typeof dynamics === 'number' ? dynamics : 0,
      anchors: time.anchors,
      recording: recordingOf(engine.getOutput(SONG_LEAD_NODE_ID, 'servo')),
      transport: transportOf(engine.getOutput(nodeId, 'transport')),
      dance: danceOf(engine.getOutput(nodeId, 'dance')),
    };
    const key = conductorLiveKey(live);
    if (key === lastKey) return;
    lastKey = key;
    store.report(live);
  };
}

const DANCE_MODES: readonly DanceLeadMode[] = ['waiting', 'locking', 'armed', 'following', 'switching', 'holding'];
/** The dance lead's mode (absent when no dancer leads, or unknown). */
function danceOf(raw: unknown): DanceLeadMode | undefined {
  return DANCE_MODES.find((m) => m === raw);
}

const TRANSPORT_READINGS: readonly ConductorTransportReading[] = ['idle', 'armed', 'prepared', 'running', 'holding', 'stopped', 'off'];
/** The body transport's reading (`off` when absent or unknown). */
function transportOf(raw: unknown): ConductorTransportReading {
  return TRANSPORT_READINGS.includes(raw as ConductorTransportReading) ? (raw as ConductorTransportReading) : 'off';
}

/** The servo's reading, while the conductor leads the song. */
function recordingOf(raw: unknown): ConductorLive['recording'] {
  if (!raw || typeof raw !== 'object' || !('mode' in raw)) return null;
  const s = raw as ServoState;
  return { mode: s.mode, rate: s.rate, error: Number.isFinite(s.error) ? s.error : 0 };
}
