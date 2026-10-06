/**
 * The drum pads in the real default graph (#245), the shipping-rule guard (the #147
 * template): the air drum's dial reaches the overlay (where the pads are drawn) and its
 * hits reach the overlay (the flash) as well as the audio scheduler.
 *
 * Then the whole production graph headless, over recorded conducting hands, with the
 * `airDrum` dial carrying pads through the same `ctx.resources.controls` getter the app
 * injects and a mock drum sink: two pads splitting the frame at its middle, each its own
 * drum. Every hit must be one of the two pads' drums (never a hand's own sound), both
 * must sound, each hit's drum must be the pad under its landing point, and the sink must
 * receive where on the pad each hit landed.
 */
import { describe, it, expect } from 'vitest';
import { runHeadless } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import type { HandsFrame } from '@/nodes';
import type { DrumHit } from '@thoremin/ext-air/nodes/air_drum';
import { DEFAULT_PADS_SET, type Pads } from '@thoremin/sdk/nodes/music/drum_pads';
import { DEFAULT_AIR_DRUM } from '@thoremin/ext-air/dials';
import { loadStream } from '../helpers/fixtures';
import { AIR } from '../helpers/extensions';

describe.runIf(AIR)('drum pads in the default graph', () => {
  it('wires the dial and the hits to the overlay, and the hits to the scheduler (the #245 guard)', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) => edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    expect(has('ui', 'airDrum', 'overlay', 'airDrumConfig')).toBe(true);
    expect(has('airDrum', 'hits', 'overlay', 'drumHits')).toBe(true);
    expect(has('airDrum', 'hits', 'drumOut', 'hits')).toBe(true);
    expect(has('ui', 'airDrum', 'airDrum', 'config')).toBe(true);
  });

  it('headless: each hit sounds the drum of the pad it landed on, with its place on the pad', async () => {
    const FPS = 30;
    const ticks = 300;
    const frames = loadStream('conducting_44', 'src.hands') as HandsFrame[];
    // Two pads splitting the displayed frame down the middle; the rest off. A stroke can
    // land below the frame's edge (off both pads); 'nearest' gives it the pad on its side.
    const pads: Pads = {
      ...DEFAULT_PADS_SET,
      p1: { ...DEFAULT_PADS_SET.p1, on: true, shape: 'rect', x: 0.25, y: 0.5, w: 0.5, h: 1, sound: 'crash' },
      p2: { ...DEFAULT_PADS_SET.p2, on: true, shape: 'rect', x: 0.75, y: 0.5, w: 0.5, h: 1, sound: 'tom' },
    };
    const registry = createAppRegistry();
    const g = defaultGraph({ source: 'replay-hands' }, registry);
    g.nodes.find((n) => n.id === 'cam')!.params = { frames: frames.slice(0, ticks) };
    const voice = { root: 0, type: 'major', octaves: 2, baseOctave: 3, sound: 'sine' } as const;
    const controls = () => ({ right: voice, left: { ...voice, sound: 'triangle' as const }, airDrum: { ...DEFAULT_AIR_DRUM, enabled: true, mirrorHandedness: false, pads, offPad: 'nearest' as const } });
    const played: { sound: string; radial: number }[] = [];
    const { recorder } = await runHeadless(g, registry, {
      ticks,
      nominalDt: 1 / FPS,
      resources: {
        controls,
        createDrumSink: () => ({ play: (sound: string, _v: number, _w: number, touch?: { radial?: number }) => void played.push({ sound, radial: touch?.radial ?? NaN }), close: () => {} }),
      },
      recordOnly: ['airDrum.hits'],
    });
    const hits = (recorder.values('airDrum.hits') as DrumHit[][]).flat();
    expect(hits.length).toBeGreaterThan(5);
    expect(played).toHaveLength(hits.length);
    // Only the pads' drums, and both of them.
    expect(new Set(played.map((p) => p.sound))).toEqual(new Set(['crash', 'tom']));
    for (const h of hits) {
      expect(h.pad === 'p1' || h.pad === 'p2').toBe(true);
      expect(h.sound).toBe(h.pad === 'p1' ? 'crash' : 'tom');
      // A hit that landed ON a pad (inside the frame) is the pad under its landing point.
      if (h.radial! < 1) expect(h.pad).toBe(h.x! < 0.5 ? 'p1' : 'p2');
    }
    // A conductor's downbeat is low in the frame, and the virtual stick reaches past its
    // edge: a good share of hits still land ON a pad.
    expect(hits.filter((h) => h.radial! < 1).length).toBeGreaterThan(hits.length / 3);
    // The sink is told where on the pad each hit landed.
    expect(played.every((p) => p.radial >= 0 && p.radial <= 1)).toBe(true);
    expect(new Set(played.map((p) => p.radial.toFixed(2))).size).toBeGreaterThan(1);
  });
});
