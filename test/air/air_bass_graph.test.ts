/**
 * The air bass inside the real default graph (#249), on the #147 template the air drum
 * follows: the dial reaches the node as a LIVE input, the hands and the instrument's
 * scale reach it, and its notes reach the audio scheduler. Then the whole production
 * graph headless on a synthetic performance replayed through the source slot, with the
 * dial turned on through the same `ctx.resources.controls` getter the app injects and a
 * mock pluck sink: the sink must be asked to play the neck's notes.
 */
import { describe, it, expect } from 'vitest';
import { runHeadless } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import { DEFAULT_AIR_BASS } from '@thoremin/ext-air/dials';
import { generateScale } from '@thoremin/sdk/music/theory';
import { bassTake } from './synthetic_bass';
import { AIR } from '../helpers/extensions';

describe.runIf(AIR)('air bass in the default graph', () => {
  it('wires the dial, the hands, the scale and the notes — the #249 guard', () => {
    const g = defaultGraph();
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      g.edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    expect(g.nodes.some((n) => n.id === 'airBass' && n.type === 'air-bass')).toBe(true);
    expect(g.nodes.some((n) => n.id === 'bassOut' && n.type === 'pluck-out')).toBe(true);
    expect(has('ui', 'airBass', 'airBass', 'config')).toBe(true);
    expect(has('cam', 'hands', 'airBass', 'hands')).toBe(true);
    expect(has('ui', 'scaleRight', 'airBass', 'scale')).toBe(true);
    expect(has('ui', 'octaveShift', 'airBass', 'octaveShift')).toBe(true);
    expect(has('airBass', 'notes', 'bassOut', 'notes')).toBe(true);
    const inbound = (id: string) => new Set(g.edges.filter((e) => e.to.node === id).map((e) => e.to.port));
    expect([...inbound('airBass')].sort()).toEqual(['config', 'hands', 'octaveShift', 'scale']);
    expect([...inbound('bassOut')].sort()).toEqual(['mute', 'notes']);
  });

  describe('headless over the production graph (a synthetic performance)', () => {
    const FPS = 30;
    const frames = bassTake({ duration: 6, neck: (t) => (t < 3 ? 6.5 : 2.2) });
    const voice = { root: 4, type: 'minorPentatonic', octaves: 2, baseOctave: 2, sound: 'sine' } as const;
    const scale = generateScale(voice);
    const run = async (enabled: boolean) => {
      const registry = createAppRegistry();
      const g = defaultGraph({ source: 'replay-hands' }, registry);
      g.nodes.find((n) => n.id === 'cam')!.params = { frames };
      const played: number[] = [];
      const controls = () => ({ right: voice, left: voice, airBass: { ...DEFAULT_AIR_BASS, enabled, mirrorHandedness: false } });
      const { recorder } = await runHeadless(g, registry, {
        ticks: frames.length,
        nominalDt: 1 / FPS,
        resources: {
          controls,
          createPluckSink: () => ({ play: (midi: number) => void played.push(midi), close: () => {} }),
        },
        recordOnly: ['airBass.notes', 'airBass.enabled'],
      });
      const notes = (recorder.values('airBass.notes') as unknown[][]).reduce((n, h) => n + h.length, 0);
      const enabledOut = recorder.values('airBass.enabled') as boolean[];
      return { played, notes, enabled: enabledOut[enabledOut.length - 1] };
    };

    it('with the dial on, the plucks become notes of the scale and the pluck sink plays them', async () => {
      const r = await run(true);
      expect(r.enabled).toBe(true);
      expect(r.notes).toBeGreaterThanOrEqual(8);
      expect(r.played.length).toBe(r.notes);
      for (const m of r.played) expect(scale).toContain(m);
      // Far out on the neck first, close in last: the bass line climbs.
      expect(r.played[0]).toBeLessThan(r.played[r.played.length - 1]);
    });

    it('with the dial off, nothing is played', async () => {
      const r = await run(false);
      expect(r.enabled).toBe(false);
      expect(r.played).toEqual([]);
    });
  });
});
