/**
 * The air drum inside the real default graph (#233) — the structural guard of the
 * shipping rule (the #147 template): the dial reaches the node as a LIVE input, the
 * hands and the conductor's time reach it, and its hits reach the audio scheduler.
 * A port left unconnected here is a panel that looks alive and sounds nothing.
 *
 * Then the whole production graph headless: the recorded conducting hands replayed
 * through the source slot with the dial turned on through the same
 * `ctx.resources.controls` getter the app injects and a mock drum sink in the
 * resources — the sink must be asked to play, which proves reachability on the real
 * wiring rather than on a bespoke spec.
 */
import { describe, it, expect } from 'vitest';
import { runHeadless } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import type { HandsFrame } from '@/nodes';
import { DEFAULT_AIR_DRUM } from '@/settings/schema';
import { loadStream } from '../helpers/fixtures';

describe('air drum in the default graph', () => {
  it('wires the dial, the hands, the conductor time and the hits — the #233 guard', () => {
    const g = defaultGraph();
    const edges = g.edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    expect(g.nodes.some((n) => n.id === 'airDrum' && n.type === 'air-drum')).toBe(true);
    expect(g.nodes.some((n) => n.id === 'drumOut' && n.type === 'drum-out')).toBe(true);
    expect(has('ui', 'airDrum', 'airDrum', 'config')).toBe(true);
    expect(has('cam', 'hands', 'airDrum', 'hands')).toBe(true);
    expect(has('conductor', 'time', 'airDrum', 'time')).toBe(true);
    expect(has('airDrum', 'hits', 'drumOut', 'hits')).toBe(true);
    // Every input of the two nodes is fed.
    const inbound = (id: string) => new Set(edges.filter((e) => e.to.node === id).map((e) => e.to.port));
    expect([...inbound('airDrum')].sort()).toEqual(['config', 'hands', 'time']);
    expect([...inbound('drumOut')]).toEqual(['hits']);
  });

  describe('headless over the production graph (replayed hands)', () => {
    const FPS = 30;
    const frames = loadStream('conducting_44', 'src.hands') as HandsFrame[];
    const ticks = 300;
    /** The minimum `ControlSnapshot` store-controls needs (the app injects the whole store). */
    const baseControls = () => {
      const voice = { root: 0, type: 'major', octaves: 2, baseOctave: 3, sound: 'sine' } as const;
      return { right: voice, left: { ...voice, sound: 'triangle' as const } };
    };
    const run = async (enabled: boolean) => {
      const registry = createAppRegistry();
      const g = defaultGraph({ source: 'replay-hands' }, registry);
      const cam = g.nodes.find((n) => n.id === 'cam')!;
      cam.params = { frames: frames.slice(0, ticks) };
      const played: string[] = [];
      const controls = () => ({ ...baseControls(), airDrum: { ...DEFAULT_AIR_DRUM, enabled, mirrorHandedness: false } });
      const { recorder } = await runHeadless(g, registry, {
        ticks,
        nominalDt: 1 / FPS,
        // No WebAudio in Node: the injected sink needs none (the synth stays silent).
        resources: {
          controls,
          createDrumSink: () => ({ play: (sound: string) => void played.push(sound), close: () => {} }),
        },
        recordOnly: ['airDrum.hits', 'airDrum.enabled'],
      });
      const hits = (recorder.values('airDrum.hits') as unknown[][]).reduce((n, h) => n + h.length, 0);
      const enabledOut = recorder.values('airDrum.enabled') as boolean[];
      return { played: played.length, hits, enabled: enabledOut[enabledOut.length - 1] };
    };

    it('with the dial on, the conductor\'s strokes become hits and the drum sink is asked to play them', async () => {
      const r = await run(true);
      expect(r.enabled).toBe(true);
      // She beats about a dozen times in ten seconds; each stroke is a hit.
      expect(r.hits).toBeGreaterThan(5);
      expect(r.played).toBe(r.hits);
    });

    it('with the dial off, nothing is played', async () => {
      const r = await run(false);
      expect(r.enabled).toBe(false);
      expect(r.hits).toBe(0);
      expect(r.played).toBe(0);
    });
  });
});
