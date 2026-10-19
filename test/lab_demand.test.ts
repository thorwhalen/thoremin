/**
 * The Feature Lab as a feature-demand claimer (#600 S16a): while its meters are shown it claims the
 * groups it shows, so the derivation, the hand count and the feature-vector gates read the demand
 * and never the Lab's config. The claim follows the config, and the uninstall releases it.
 */
import { describe, expect, it } from 'vitest';
import { createFeatureDemand } from '@thoremin/sdk/features/demand';
import { installLabDemand, LAB_DEMAND_OWNER, labDemandGroups } from '@/app/labDemand';

describe('the Lab claims its shown groups', () => {
  it('claims nothing while hidden, its groups while shown', () => {
    expect(labDemandGroups(undefined)).toEqual([]);
    expect(labDemandGroups({ show: false, groups: ['face.head'] })).toEqual([]);
    expect(labDemandGroups({ show: true, groups: ['face.head', 'hand.geom'] })).toEqual(['face.head', 'hand.geom']);
  });

  it('keeps the claim in step with the config, and releases it on uninstall', () => {
    const demand = createFeatureDemand();
    let cfg = { show: false, groups: ['face.head'] };
    const listeners = new Set<() => void>();
    const uninstall = installLabDemand(() => cfg, (l) => (listeners.add(l), () => listeners.delete(l)), demand);
    const change = (next: typeof cfg) => {
      cfg = next;
      for (const l of listeners) l();
    };
    expect(demand.groups()).toBeNull();
    change({ show: true, groups: ['face.head'] });
    expect([...(demand.groups() ?? [])]).toEqual(['face.head']);
    expect(demand.owners()).toEqual([LAB_DEMAND_OWNER]);
    change({ show: true, groups: ['face.head', 'body.pos'] });
    expect([...(demand.groups() ?? [])].sort()).toEqual(['body.pos', 'face.head']);
    change({ show: false, groups: ['face.head', 'body.pos'] });
    expect(demand.groups()).toBeNull();
    change({ show: true, groups: ['face.head'] });
    uninstall();
    expect(demand.groups()).toBeNull();
    expect(listeners.size).toBe(0);
  });
});
