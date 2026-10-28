/**
 * The Physical Theremin seed in its composed graph: the structural guard (the dial reaches the node
 * as a live input, the hands and the scale reach it, its voice reaches the merge and its status the
 * overlay), then the seed's own graph on REAL hand landmarks (the signer's held open palm, placed
 * by script at distances from the rod: `scripts/stability/lib_theremin.ts`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeInstrumentGraph, branchIdsFor } from '@/app/graph';
import { createAppRegistry } from '@/nodes/browser';
import { loadRecords, FIXTURES } from '../helpers/fixtures';
import { THEREMIN } from '../helpers/extensions';
import { runSeed, seedSettings } from '../../scripts/stability/lib_run';
import { performance } from '../../scripts/stability/lib_streams';
import { MAP_H, MAP_W, openPalmTemplate } from '../../scripts/stability/suite';
import { THEREMIN_NODE, THEREMIN_SEED, thereminScript } from '../../scripts/stability/lib_theremin';
import { DEFAULT_PHYSICAL_THEREMIN as D } from '@/slices/theremin/schema';
import { DROPOUT_HOLD_S, PHYSICAL_THEREMIN_VOICE_ID, type PhysicalThereminStatus } from '@/slices/theremin/nodes/physical_theremin';
import type { SynthParams } from '@thoremin/sdk/nodes/domain';

describe.runIf(THEREMIN)('the Physical Theremin seed', () => {
  it('composes its branch, wired to the hands, the dial, the scale, the merge and the overlay', () => {
    const settings = seedSettings(THEREMIN_SEED);
    const branches = branchIdsFor(settings);
    expect(branches).toContain('physical-theremin');
    const { spec } = composeInstrumentGraph(branches, {}, createAppRegistry());
    const has = (fn: string, fp: string, tn: string, tp: string) => spec.edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    expect(spec.nodes.some((n) => n.id === THEREMIN_NODE && n.type === 'physical-theremin')).toBe(true);
    expect(has('dwelled', 'hands', THEREMIN_NODE, 'hands')).toBe(true);
    expect(has('ui', 'physicalTheremin', THEREMIN_NODE, 'config')).toBe(true);
    expect(has('ui', 'scaleRight', THEREMIN_NODE, 'scale')).toBe(true);
    expect(spec.edges.some((e) => e.from.node === THEREMIN_NODE && e.from.port === 'params' && e.to.node === 'merge')).toBe(true);
    expect(has(THEREMIN_NODE, 'status', 'overlay', 'physical-theremin.antennas.status')).toBe(true);
    // The default map's theremin voices are silent in this seed: only the physics plays.
    expect((settings as { handMap: { maxGain: number } }).handMap.maxGain).toBe(0);
  });

  describe('on a real held hand', () => {
    const meta = JSON.parse(readFileSync(join(FIXTURES, 'real_hands_signs', 'meta.json'), 'utf8'));
    const perf = performance(openPalmTemplate(loadRecords, meta), thereminScript().script, { width: MAP_W, height: MAP_H, handedness: 'Left' });
    const play = (level: number) =>
      runSeed(THEREMIN_SEED, perf.frames, {
        patch: { physicalTheremin: { ...D, enabled: true, assist: { ...D.assist, level } } },
        record: [`${THEREMIN_NODE}.status`],
      });

    it('sounds while the hand is in view, in range, and at level 0 is exactly the raw physics', async () => {
      const run = await play(0);
      const status = run.values(`${THEREMIN_NODE}.status`) as PhysicalThereminStatus[];
      const merged = run.values('merge.params') as SynthParams[];
      const sounding = status.filter((s) => s.sounding);
      expect(sounding.length).toBeGreaterThan(perf.frames.length * 0.7);
      for (const s of sounding) {
        expect(s.midi).toBe(s.rawMidi);
        expect(s.hz).toBeGreaterThanOrEqual(20);
        expect(s.hz).toBeLessThanOrEqual(8000);
      }
      // The voice reaches the merge, and is silent once the hand has gone for longer than the
      // dropout hold (plus the handedness dwell's frames).
      const voiceAt = (i: number) => merged[i]?.voices.find((v) => v.id === PHYSICAL_THEREMIN_VOICE_ID);
      const lastSeen = perf.at.reduce((last, p, i) => (p !== null ? i : last), -1);
      const gone = perf.at.map((_, i) => i).filter((i) => i > lastSeen + Math.ceil((DROPOUT_HOLD_S + 0.2) * 30));
      expect(gone.length).toBeGreaterThan(5);
      expect(perf.at.some((p, i) => p !== null && voiceAt(i)?.present)).toBe(true);
      for (const i of gone) expect(voiceAt(i)?.present ?? false).toBe(false);
    });

    it('full assistance snaps to the scale: every sounding pitch is a note', async () => {
      const run = await play(1);
      const status = run.values(`${THEREMIN_NODE}.status`) as PhysicalThereminStatus[];
      const notes = status.filter((s) => s.sounding && s.vibrato < 0.5 && s.target !== null);
      expect(notes.length).toBeGreaterThan(50);
      // Pull 1: on the target note (the vibrato aid only adds a protected wobble).
      for (const s of notes) expect(Math.abs(s.midi! - s.target!)).toBeLessThan(0.5);
    });
  });
});
