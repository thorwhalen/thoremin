/**
 * The chord map's dial wiring of the harmony libraries (#713, #714 PR B2): an idiom chosen on the
 * dial draws its next chords as a ghost trail from the chord in force and follows the player along
 * it (off the path it waits); the computed caption set puts words on the moves; the defaults draw
 * no trail and keep the interval captions.
 */
import { describe, it, expect } from 'vitest';
import { chordMapNode, chordMapRegions, type ChordMapStatus } from '@thoremin/ext-harmony/nodes/chord_map';
import { layoutCells, moveText } from '@thoremin/ext-harmony/lib/chord_map';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import type { CellGrid } from '@thoremin/sdk/nodes/cell_grid';
import { chordMapTake, W, H } from './synthetic_chord_map';

const C_MAJOR: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };
const ON = { enabled: true, mirrorHandedness: false };

interface Out {
  grid: CellGrid;
  status: ChordMapStatus;
}

function play(frames: HandsFrame[], config: Record<string, unknown>) {
  const h = chordMapNode.make(chordMapNode.params.parse({}));
  return frames.map((f) => ({ t: f.t!, out: h.process({ hands: f, config, spec: C_MAJOR, octaveShift: 0 }, { time: f.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as Out }));
}
const cellOf = (degree: number) =>
  layoutCells('harmonic', chordMapRegions('left', 0.65).chords, { aspect: W / H, cellSize: 0.2 })
    .filter((c) => c.degree === degree)
    .sort((a, b) => Math.abs(a.q) + Math.abs(a.r) - (Math.abs(b.q) + Math.abs(b.r)))[0];
const at = (outs: { t: number; out: Out }[], t: number) => outs.find((o) => o.t >= t)!.out;

describe('the chord map with an idiom', () => {
  it('draws no trail by default', () => {
    const outs = play(chordMapTake({ duration: 0.6, chordAt: () => cellOf(0) }), ON);
    expect(at(outs, 0.5).grid.trails).toBeUndefined();
    expect(at(outs, 0.5).status.idiom).toBeNull();
  });

  it("follows Pachelbel's ground: I, V, vi each move the cursor and the trail goes on ahead", () => {
    // Pachelbel: I V vi iii IV I IV V.
    const path = [0, 4, 5];
    const outs = play(chordMapTake({ duration: 3, chordAt: (t) => cellOf(path[Math.min(2, Math.floor(t))]) }), { ...ON, idiom: 'pachelbel', trailSteps: 2 });
    expect(at(outs, 0.6).status.idiom).toMatchObject({ name: 'Pachelbel', step: 1, steps: 8, onPath: true });
    expect(at(outs, 1.6).status.idiom).toMatchObject({ step: 2, onPath: true });
    const last = at(outs, 2.6);
    expect(last.status.idiom).toMatchObject({ step: 3, onPath: true });
    // Two chords ahead of vi: iii, then IV, drawn from the cell in force.
    const trail = last.grid.trails?.[0];
    expect(trail?.label).toBe('Pachelbel');
    expect(trail?.points).toHaveLength(2);
    expect(trail?.from).toBeDefined();
  });

  it('a chord off the path leaves the cursor where it was', () => {
    const outs = play(chordMapTake({ duration: 2, chordAt: (t) => cellOf(t < 1 ? 0 : 1) }), { ...ON, idiom: 'pachelbel' });
    expect(at(outs, 1.6).status.idiom).toMatchObject({ step: 1, onPath: false });
    expect(at(outs, 1.6).grid.trails?.[0].points).toHaveLength(3);
  });
});

describe('the chord map caption set', () => {
  it('interval captions by default, computed words on the moves when chosen', () => {
    const intervals = new Set([1, 2, 3, 4, 5, 6].flatMap((d) => [moveText(0, d), moveText(d, 0)]));
    const plain = at(play(chordMapTake({ duration: 0.6, chordAt: () => cellOf(0) }), { ...ON, melody: false }), 0.5).grid.captions.map((c) => c.text);
    expect(plain.length).toBeGreaterThan(0);
    for (const t of plain) expect(intervals.has(t)).toBe(true);
    const computed = at(play(chordMapTake({ duration: 0.6, chordAt: () => cellOf(0) }), { ...ON, melody: false, captionSet: 'computed' }), 0.5).grid.captions.map((c) => c.text);
    expect(computed).toHaveLength(plain.length);
    expect(computed.some((t) => !intervals.has(t))).toBe(true);
  });
});
