/**
 * conductorStatus — a tiny store the engine loop writes the live conductor state
 * into (#187 PR 4), so the Conductor tool panel can show what the follower is doing:
 * ready / running / hold, the tempo it is advancing at, where in the bar it is, how
 * confident it is, and the dynamics. Ephemeral per-frame runtime state, exactly like
 * `generativeStatus` and `midiStatus` — the DAG produces it; React only displays it.
 *
 * {@link makeConductorReporter} is the per-frame sink behind the slice's status hook: it
 * reads the `conductor` node's `time`, `dynamics`, `enabled`, `transport` and `dance`
 * outputs and reports only when something a player can SEE changed (the state, the
 * whole beat, the tempo to the bpm, the confidence and dynamics to a twentieth), so the
 * panel never re-renders 60×/s for a phase that merely crept.
 *
 * Since #983 the store is the shared status-store factory's (`@thoremin/sdk-ui/statusStore`),
 * reading several ports of its one node through `read`: its hook then starts the change
 * gate afresh when the node leaves and when the engine goes, so a conductor that comes back
 * with the reading it left with is shown again rather than staying absent.
 */
import { type DanceLeadMode, type MusicalTime } from '@thoremin/ictus';
import { createStatusStore, type StatusState } from '@thoremin/sdk-ui/statusStore';
import type { OutputReader } from '@thoremin/sdk-ui/types';
import type { ConductorTransportReading } from '../nodes/conductor';

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
  transport: 'off',
};

/** The node id the reporter reads — the `conductor` node in `graph.ts`. */
export const CONDUCTOR_NODE_ID = 'conductor';

/** Quantise what the panel shows, so the change gate compares what a player sees. */
export function conductorLiveKey(l: ConductorLive): string {
  return `${l.enabled ? 1 : 0}|${l.state}|${Math.round(l.tempo)}|${l.beat}|${l.beatInBar}|${l.beatsPerBar}|${Math.round(l.confidence * 20)}|${Math.round(l.dynamics * 20)}|${l.anchors}|${l.transport ?? 'off'}|${l.dance ?? '-'}`;
}

/** The conductor's reading, assembled from its node's `time`, `dynamics`, `enabled`, `transport`
 *  and `dance` outputs; undefined before the node has computed a time. */
export function readConductorLive(engine: OutputReader, nodeId: string): ConductorLive | undefined {
  const time = engine.getOutput(nodeId, 'time') as MusicalTime | undefined;
  if (!time) return undefined;
  const dynamics = engine.getOutput(nodeId, 'dynamics');
  const enabled = engine.getOutput(nodeId, 'enabled');
  return {
    enabled: enabled === true,
    state: time.state,
    tempo: Number.isFinite(time.tempo) ? time.tempo : 0,
    beat: Math.floor(time.beat),
    beatInBar: time.beatInBar,
    beatsPerBar: time.beatsPerBar,
    confidence: time.confidence,
    dynamics: typeof dynamics === 'number' ? dynamics : 0,
    anchors: time.anchors,
    transport: transportOf(engine.getOutput(nodeId, 'transport')),
    dance: danceOf(engine.getOutput(nodeId, 'dance')),
  };
}

/** The conductor's store, reporter and status hook: the shared factory's, over several ports of
 *  the one node (#983), so its hook clears the change gate on removal and reset like every other. */
export const CONDUCTOR_STATUS = createStatusStore(CONDUCTOR_NODE_ID, {
  absent: ABSENT_CONDUCTOR_LIVE,
  keyOf: conductorLiveKey,
  read: readConductorLive,
  field: 'live',
});

export type ConductorStatusState = StatusState<ConductorLive, 'live'>;

export const useConductorStatus = CONDUCTOR_STATUS.useStatus;

/**
 * Build the per-frame sink: read the conductor node's outputs, report them to
 * {@link useConductorStatus} (or `store`) when something visible changed. Pure over the reader, so
 * it is testable with a stub engine.
 */
export const makeConductorReporter = CONDUCTOR_STATUS.makeReporter;

const DANCE_MODES: readonly DanceLeadMode[] = ['waiting', 'locking', 'armed', 'following', 'switching', 'holding', 'fermata', 'ended'];
/** The dance lead's mode (absent when no dancer leads, or unknown). */
function danceOf(raw: unknown): DanceLeadMode | undefined {
  return DANCE_MODES.find((m) => m === raw);
}

const TRANSPORT_READINGS: readonly ConductorTransportReading[] = ['idle', 'armed', 'prepared', 'running', 'holding', 'stopped', 'off'];
/** The body transport's reading (`off` when absent or unknown). */
function transportOf(raw: unknown): ConductorTransportReading {
  return TRANSPORT_READINGS.includes(raw as ConductorTransportReading) ? (raw as ConductorTransportReading) : 'off';
}

