/**
 * Canonical fixture scenarios — pure data (no side effects), shared by the
 * recorder (`record_stream.ts`) and the disk-replay tests so node params can
 * never drift between what was recorded and what a test replays.
 */
import type { GraphSpec } from '@/dag';

export const FEAT_PARAMS = { mirrorX: false, mirrorHandedness: false };

export const MAP_PARAMS = {
  magnetism: 1,
  right: { scale: { root: 0, type: 'major', octaves: 2, baseOctave: 3 }, sound: 'sine' },
  left: { scale: { root: 0, type: 'minorPentatonic', octaves: 2, baseOctave: 2 }, sound: 'triangle' },
};

export function pipeline(handsParams: Record<string, unknown>): GraphSpec {
  return {
    nodes: [
      { id: 'src', type: 'synthetic-hands', params: handsParams },
      { id: 'feat', type: 'hand-features', params: FEAT_PARAMS },
      { id: 'map', type: 'voice-mapping', params: MAP_PARAMS },
    ],
    edges: [
      { from: { node: 'src', port: 'hands' }, to: { node: 'feat', port: 'hands' } },
      { from: { node: 'feat', port: 'features' }, to: { node: 'map', port: 'features' } },
    ],
  };
}

export interface Scenario {
  graph: GraphSpec;
  ticks: number;
  fps: number;
}

export const SCENARIOS: Record<string, Scenario> = {
  sweep_right: { graph: pipeline({ hands: 'right', sweepPeriod: 4 }), ticks: 90, fps: 30 },
  two_hands: { graph: pipeline({ hands: 'both', sweepPeriod: 3 }), ticks: 90, fps: 30 },
};
