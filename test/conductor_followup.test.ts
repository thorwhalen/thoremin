/**
 * Two conductor edges from the sprint review (#391 item 5, #393 lower severity):
 *
 *  - an instrument saved before #336 has a `conductor` dial but no `conductor.orchestra`.
 *    Both halves of the dirty compare must heal it the same way, or the instrument reads
 *    as edited on every reload: `normalizeLayer(saved).conductor` (the saved half) must
 *    equal what `mergeControls` makes of the same blob (the hot-store half);
 *  - a fermata written on beat 0 holds the beat there, like one on any other beat:
 *    stopped at 0 when the first stroke would move it, released by the next stroke.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { conductorNode, type HandsFrame } from '@/nodes';
import { normalizeLayer } from '@/app/dials/instruments';
import { mergeControls, useControls } from '@/app/store';
import { DEFAULT_CONDUCTOR } from '@/settings/schema';
import { loadStream } from './helpers/fixtures';

/** The conductor dial as an instrument saved before #336 stored it (a JSON round trip). */
const preOrchestra = () => {
  const { orchestra: _dropped, ...old } = DEFAULT_CONDUCTOR as Record<string, unknown> & { orchestra: unknown };
  void _dropped;
  return JSON.parse(JSON.stringify({ ...old, enabled: true })) as Record<string, unknown>;
};

describe('a saved conductor with no orchestra (before #336)', () => {
  it('the fixture is what a pre-#336 save holds: a prior, no orchestra', () => {
    const saved = preOrchestra();
    expect(saved.orchestra).toBeUndefined();
    expect(saved.prior).toBeDefined();
    // The hot store heals it with the default orchestra.
    const merged = mergeControls({ conductor: saved }, useControls.getState());
    expect((merged.conductor as { orchestra?: unknown }).orchestra).toEqual(DEFAULT_CONDUCTOR.orchestra);
  });

  it.fails('normalizeLayer(saved).conductor deep-equals what mergeControls makes of it (#393 lower: pre-#336 instruments read as edited)', () => {
    const saved = preOrchestra();
    const healed = normalizeLayer({ conductor: structuredClone(saved) });
    const merged = mergeControls({ conductor: structuredClone(saved) }, useControls.getState());
    expect(healed.conductor).toEqual(merged.conductor);
  });

  it('a conductor saved with its orchestra already heals identically on both halves (the control case)', () => {
    const saved = JSON.parse(JSON.stringify({ ...DEFAULT_CONDUCTOR, enabled: true }));
    const healed = normalizeLayer({ conductor: structuredClone(saved) });
    const merged = mergeControls({ conductor: structuredClone(saved) }, useControls.getState());
    expect(healed.conductor).toEqual(merged.conductor);
  });
});

describe('a fermata at beat 0', () => {
  const FPS = 30;
  const frames = loadStream('conducting_44', 'src.hands') as HandsFrame[];
  const RECORDED = { mirrorX: false, mirrorHandedness: false };
  const docWith = (fermatas: number[]) => ({
    v: 1,
    title: 'fermata at 0',
    source: 'builtin',
    parts: [{ id: 'p', name: 'p', percussion: false, notes: [{ midi: 60, start: 0, duration: 12, velocity: 1 }] }],
    tempoMap: [],
    timeSignatures: [],
    dynamics: [],
    fermatas,
    lengthBeats: 12,
  });
  const run = async (fermatas: number[]) => {
    const h = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
    const doc = docWith(fermatas);
    const outs = await replayNode(h, { hands: frames, doc: frames.map(() => doc) }, { dt: 1 / FPS });
    return outs.map((o) => ({ beat: o.beat as number, bpm: o.bpm as number, time: o.time as { state: string; anchors: number } }));
  };

  it('with no fermata the beat leaves 0 at the first stroke (the control case)', async () => {
    const free = await run([]);
    const leaves = free.findIndex((o) => o.beat > 0);
    expect(leaves).toBeGreaterThan(0);
    expect(free[leaves].time.anchors).toBeGreaterThan(0);
  });

  it.fails('is held: the beat stays at 0, reading hold, until a stroke after the one that would have moved it (#393 lower: fermata at beat 0)', async () => {
    const free = await run([]);
    const held = await run([0]);
    const freeLeaves = free.findIndex((o) => o.beat > 0);
    // Where the free beat first moves, the held one is stopped on the fermata.
    expect(held[freeLeaves].beat).toBe(0);
    expect(held[freeLeaves].bpm).toBe(0);
    expect(held[freeLeaves].time.state).toBe('hold');
    // It leaves 0 only on a later stroke, and then plays on.
    const heldLeaves = held.findIndex((o) => o.beat > 0);
    expect(heldLeaves).toBeGreaterThan(freeLeaves);
    expect(held[heldLeaves].time.anchors).toBeGreaterThan(held[freeLeaves].time.anchors);
    expect(held[held.length - 1].beat).toBeGreaterThan(4);
  });
});
