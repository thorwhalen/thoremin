/**
 * The air flute claims the mouth (#249): while it is on with the mouth as its breath, the
 * face catalog's mouth groups are demanded (which also loads the face model); off, or in
 * "fingers only", the claim is released.
 */
import { describe, it, expect } from 'vitest';
import { airFluteGroups, startAirFluteDemand, AIR_FLUTE_DEMAND_OWNER } from '@thoremin/ext-air/app/airFluteDemand';
import { MOUTH_GROUPS } from '@thoremin/ext-air/nodes/air_flute';
import { demandWantsFace } from '@/features/labConfig';

describe('the air flute demand', () => {
  it('claims the mouth groups only when on in the mouth mode', () => {
    expect(airFluteGroups({ enabled: true, breath: 'mouth' })).toEqual([...MOUTH_GROUPS]);
    expect(airFluteGroups({ enabled: true })).toEqual([...MOUTH_GROUPS]);
    expect(airFluteGroups({ enabled: true, breath: 'always' })).toEqual([]);
    expect(airFluteGroups({ enabled: false, breath: 'mouth' })).toEqual([]);
    expect(airFluteGroups(undefined)).toEqual([]);
    // Claiming them is what turns the face model on.
    expect(demandWantsFace(new Set(MOUTH_GROUPS))).toBe(true);
  });

  it('follows the dial: claim on, release off, release on stop', () => {
    const calls: string[] = [];
    const demand = {
      claim: (owner: string, groups: readonly string[]) => void calls.push(`claim ${owner} ${groups.length}`),
      release: (owner: string) => void calls.push(`release ${owner}`),
    } as never;
    let listener: (s: { airFlute?: { enabled?: boolean } }) => void = () => {};
    let state: { airFlute?: { enabled?: boolean } } = { airFlute: { enabled: false } };
    const store = { getState: () => state, subscribe: (l: typeof listener) => ((listener = l), () => {}) };
    const stop = startAirFluteDemand(store as never, demand);
    state = { airFlute: { enabled: true } };
    listener(state);
    listener(state); // unchanged: no second claim
    state = { airFlute: { enabled: false } };
    listener(state);
    stop();
    // Off at start claims nothing (nothing to release either); on claims; off releases; stop releases.
    expect(calls).toEqual([`claim ${AIR_FLUTE_DEMAND_OWNER} ${MOUTH_GROUPS.length}`, `release ${AIR_FLUTE_DEMAND_OWNER}`, `release ${AIR_FLUTE_DEMAND_OWNER}`]);
  });
});
