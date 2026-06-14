/**
 * Headless contract test for the `lyria` node — drives it with a MOCK
 * GenerativeEngine (no network, no audio) and verifies the steering contract:
 * lifecycle (connect/play/pause), throttled + diffed steer updates, and a
 * context reset on tempo change. This is where the real bugs live, so it's the
 * part worth testing without a live Lyria connection.
 */
import { describe, it, expect } from 'vitest';
import { Engine, StreamRecorder } from '@/dag';
import { createCoreRegistry, lyriaNode } from '@/nodes';
import type { GenerativeConfig, GenerativeEngine, GenerativeSteer, WeightedPrompt } from '@/nodes';

class MockEngine implements GenerativeEngine {
  calls: string[] = [];
  prompts: WeightedPrompt[][] = [];
  configs: GenerativeConfig[] = [];
  async connect() {
    this.calls.push('connect');
  }
  async play() {
    this.calls.push('play');
  }
  async pause() {
    this.calls.push('pause');
  }
  async stop() {
    this.calls.push('stop');
  }
  setWeightedPrompts(p: WeightedPrompt[]) {
    this.calls.push('setWeightedPrompts');
    this.prompts.push(p);
  }
  setConfig(c: GenerativeConfig) {
    this.calls.push('setConfig');
    this.configs.push(c);
  }
  resetContext() {
    this.calls.push('resetContext');
  }
}

function steer(weight: number, bpm: number): GenerativeSteer {
  return { prompts: [{ text: 'ambient pads', weight }], config: { bpm, density: 0.5 } };
}

describe('lyria node (contract logic, mock engine)', () => {
  it('no-ops without an engine', () => {
    const handlers = lyriaNode.make({ throttleSec: 0.2 });
    const out = handlers.process({ playing: true, steer: steer(1, 120) }, { tick: 0, time: 0, dt: 0, resources: {} });
    expect(out.state).toBe('no-engine');
  });

  it('connects+plays once, throttles steer updates, resets context on bpm change', async () => {
    const engine = new MockEngine();
    const handlers = lyriaNode.make({ throttleSec: 0.2 });
    const resources = { generativeEngine: engine };
    const dt = 1 / 30;

    // 30 ticks (~1s) of "playing" with prompt weight ramping every tick and a
    // bpm change partway through.
    for (let i = 0; i < 30; i++) {
      const w = 0.5 + (i % 10) * 0.05; // changes every tick
      const bpm = i < 15 ? 120 : 90; // tempo change at tick 15
      handlers.process(
        { playing: true, steer: steer(w, bpm) },
        { tick: i, time: i * dt, dt, resources },
      );
    }
    // play() is fire-and-forget after connect() resolves (a microtask), so flush.
    await new Promise((r) => setTimeout(r, 0));

    // connect + play exactly once.
    expect(engine.calls.filter((c) => c === 'connect')).toHaveLength(1);
    expect(engine.calls.filter((c) => c === 'play')).toHaveLength(1);

    // Prompts change every tick, but pushes are throttled to ~0.2s over ~1s,
    // so far fewer than 30 sends.
    const promptSends = engine.calls.filter((c) => c === 'setWeightedPrompts').length;
    expect(promptSends).toBeGreaterThan(2);
    expect(promptSends).toBeLessThan(12);

    // The tempo change triggered exactly one resetContext.
    expect(engine.calls.filter((c) => c === 'resetContext')).toHaveLength(1);
  });

  it('pauses when transport stops', () => {
    const engine = new MockEngine();
    const handlers = lyriaNode.make({ throttleSec: 0.2 });
    const resources = { generativeEngine: engine };
    handlers.process({ playing: true, steer: steer(1, 120) }, { tick: 0, time: 0, dt: 0, resources });
    handlers.process({ playing: false }, { tick: 1, time: 0.1, dt: 0.1, resources });
    expect(engine.calls).toContain('pause');
  });

  it('is registered in the core registry and wires from indirect-map', () => {
    const spec = {
      nodes: [
        { id: 'src', type: 'synthetic-hands', params: { hands: 'right' } },
        { id: 'feat', type: 'hand-features', params: { mirrorX: false, mirrorHandedness: false } },
        {
          id: 'ind',
          type: 'indirect-map',
          params: {
            strains: [{ text: 'pads', hand: 'right', feature: 'openness', inMin: 0, inMax: 1, weightMin: 0, weightMax: 2 }],
            dials: [{ name: 'bpm', hand: 'right', feature: 'y', inMin: 0, inMax: 1, outMin: 80, outMax: 140 }],
          },
        },
        { id: 'gen', type: 'lyria' },
      ],
      edges: [
        { from: { node: 'src', port: 'hands' }, to: { node: 'feat', port: 'hands' } },
        { from: { node: 'feat', port: 'features' }, to: { node: 'ind', port: 'features' } },
        { from: { node: 'ind', port: 'steer' }, to: { node: 'gen', port: 'steer' } },
      ],
    };
    const engine = new MockEngine();
    const rec = new StreamRecorder();
    const eng = new Engine(spec, createCoreRegistry(), { resources: { generativeEngine: engine }, taps: [rec], nominalDt: 1 / 30 });
    // 'playing' is unconnected (defaults false) → lyria idles but the graph runs.
    expect(() => {
      for (let i = 0; i < 10; i++) eng.tick();
    }).not.toThrow();
    const steers = rec.values('ind.steer') as GenerativeSteer[];
    expect(steers[5].prompts[0].text).toBe('pads');
    expect(steers[5].config.bpm).toBeGreaterThanOrEqual(80);
  });
});
