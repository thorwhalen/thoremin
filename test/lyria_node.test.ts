/**
 * Headless contract test for the `lyria` node — drives it with a MOCK
 * GenerativeEngine (no network, no audio) and verifies the steering contract:
 * lifecycle (connect/play/pause), throttled + diffed steer updates, and a
 * context reset on tempo change. Since #188 the node obtains its engine through
 * the lazy-loading pattern, so this also pins the loader seam: nothing loads until
 * `enabled`, a missing key is an honest `unavailable` status, disabling drops the
 * engine (and a late arrival), re-enabling retries, a rejecting factory never
 * throws, and the vendor module is never statically re-exported into the bundle.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Engine, StreamRecorder } from '@/dag';
import type { NodeContext } from '@/dag';
import { createCoreRegistry, lyriaNode } from '@/nodes';
import type {
  GenerativeConfig,
  GenerativeEngine,
  GenerativeEngineFactory,
  GenerativeSteer,
  GenerativeStatus,
  WeightedPrompt,
} from '@/nodes';

class MockEngine implements GenerativeEngine {
  calls: string[] = [];
  prompts: WeightedPrompt[][] = [];
  configs: GenerativeConfig[] = [];
  volumes: number[] = [];
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
  setVolume(g: number) {
    this.volumes.push(g);
  }
}

function steer(weight: number, bpm: number): GenerativeSteer {
  return { prompts: [{ text: 'ambient pads', weight }], config: { bpm, density: 0.5 } };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const ctxAt = (tick: number, dt: number, resources: Record<string, unknown>): NodeContext => ({
  tick,
  time: tick * dt,
  dt,
  resources,
});
const statusOf = (out: Record<string, unknown>) => out.status as GenerativeStatus;

describe('lyria node (contract logic, mock engine)', () => {
  it('is off, loads nothing and reports phase off until enabled', () => {
    let loads = 0;
    const factory: GenerativeEngineFactory = async () => {
      loads++;
      return { resource: new MockEngine() };
    };
    const handlers = lyriaNode.make(lyriaNode.params.parse({}));
    const resources = { createGenerativeEngine: factory };
    for (let i = 0; i < 5; i++) {
      const out = handlers.process({ playing: true, steer: steer(1, 120) }, ctxAt(i, 1 / 30, resources));
      expect(statusOf(out).phase).toBe('off');
    }
    expect(loads).toBe(0);
  });

  it('connects+plays once, throttles steer updates, resets context on bpm change', async () => {
    const engine = new MockEngine();
    const handlers = lyriaNode.make(lyriaNode.params.parse({ throttleSec: 0.2 }));
    const resources = { generativeEngine: engine };
    const dt = 1 / 30;

    // Tick once to request the engine, flush so the (prebuilt) load settles.
    handlers.process({ enabled: true, playing: false }, ctxAt(0, dt, resources));
    await flush();
    expect(statusOf(handlers.process({ enabled: true, playing: false }, ctxAt(1, dt, resources))).phase).toBe('ready');

    // 30 ticks (~1s) of "playing" with prompt weight ramping every tick and a
    // bpm change partway through.
    for (let i = 2; i < 32; i++) {
      const w = 0.5 + (i % 10) * 0.05; // changes every tick
      const bpm = i < 17 ? 120 : 90; // tempo change at tick 17
      handlers.process({ enabled: true, playing: true, steer: steer(w, bpm) }, ctxAt(i, dt, resources));
    }
    // play() is fire-and-forget after connect() resolves (a microtask), so flush.
    await flush();

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

    // While playing the status is `active`.
    const out = handlers.process({ enabled: true, playing: true, steer: steer(1, 90) }, ctxAt(40, dt, resources));
    expect(statusOf(out)).toMatchObject({ phase: 'active', message: 'Playing' });
  });

  it('pauses when transport stops, and reports ready (not active)', async () => {
    const engine = new MockEngine();
    const handlers = lyriaNode.make(lyriaNode.params.parse({ throttleSec: 0.2 }));
    const resources = { generativeEngine: engine };
    handlers.process({ enabled: true, playing: true, steer: steer(1, 120) }, ctxAt(0, 0.1, resources));
    await flush();
    handlers.process({ enabled: true, playing: true, steer: steer(1, 120) }, ctxAt(1, 0.1, resources));
    await flush();
    const out = handlers.process({ enabled: true, playing: false }, ctxAt(2, 0.1, resources));
    expect(engine.calls).toContain('pause');
    expect(statusOf(out).phase).toBe('ready');
  });

  it('pushes the volume input to the engine, diffed', async () => {
    const engine = new MockEngine();
    const handlers = lyriaNode.make(lyriaNode.params.parse({}));
    const resources = { generativeEngine: engine };
    handlers.process({ enabled: true, volume: 0.5 }, ctxAt(0, 0.1, resources));
    await flush();
    for (let i = 1; i < 4; i++) handlers.process({ enabled: true, volume: 0.5 }, ctxAt(i, 0.1, resources));
    handlers.process({ enabled: true, volume: 0.9 }, ctxAt(4, 0.1, resources));
    handlers.process({ enabled: true, volume: 7 }, ctxAt(5, 0.1, resources)); // clamped
    expect(engine.volumes).toEqual([0.5, 0.9, 1]);
  });

  it('reports the factory seam honestly: loading while the factory resolves, unavailable + reason on no key', async () => {
    let resolve!: (r: Awaited<ReturnType<GenerativeEngineFactory>>) => void;
    const factory: GenerativeEngineFactory = () => new Promise((res) => (resolve = res));
    const handlers = lyriaNode.make(lyriaNode.params.parse({}));
    const resources = { createGenerativeEngine: factory };
    const loading = handlers.process({ enabled: true, playing: true }, ctxAt(0, 0.1, resources));
    expect(statusOf(loading).phase).toBe('loading');
    resolve({ resource: null, reason: 'no-key', message: 'Add a Gemini API key' });
    await flush();
    const out = handlers.process({ enabled: true, playing: true }, ctxAt(1, 0.1, resources));
    expect(statusOf(out)).toEqual({ phase: 'unavailable', reason: 'no-key', message: 'Add a Gemini API key', detail: undefined });
  });

  it('a rejecting factory becomes an error status (logged once), never a throw from process()', async () => {
    const logs: string[] = [];
    const factory: GenerativeEngineFactory = async () => {
      throw new Error('SDK failed to load');
    };
    const handlers = lyriaNode.make(lyriaNode.params.parse({}));
    const resources = { createGenerativeEngine: factory };
    const ctx = { ...ctxAt(0, 0.1, resources), log: (m: string) => logs.push(m) };
    expect(() => handlers.process({ enabled: true, playing: true }, ctx)).not.toThrow();
    await flush();
    const out = handlers.process({ enabled: true, playing: true }, { ...ctx, tick: 1, time: 0.1 });
    expect(statusOf(out).phase).toBe('error');
    expect(statusOf(out).message).toContain('SDK failed to load');
    expect(logs).toHaveLength(1);
  });

  it('disabling while playing stops + drops the engine; a factory resolving after disable is stopped, not attached; re-enable retries', async () => {
    const engines: MockEngine[] = [];
    const resolvers: Array<(e: MockEngine) => void> = [];
    const factory: GenerativeEngineFactory = () =>
      new Promise((res) =>
        resolvers.push((e) => {
          engines.push(e);
          res({ resource: e });
        }),
      );
    const handlers = lyriaNode.make(lyriaNode.params.parse({}));
    const resources = { createGenerativeEngine: factory };
    const dt = 0.1;

    // Enable → load A → play.
    handlers.process({ enabled: true, playing: true, steer: steer(1, 120) }, ctxAt(0, dt, resources));
    resolvers[0](new MockEngine());
    await flush();
    handlers.process({ enabled: true, playing: true, steer: steer(1, 120) }, ctxAt(1, dt, resources));
    await flush();
    // connect first; play after connect resolves; steering may be pushed in between.
    expect(engines[0].calls[0]).toBe('connect');
    expect(engines[0].calls).toContain('play');

    // Disable: A is stopped and dropped, status off.
    const off = handlers.process({ enabled: false, playing: true }, ctxAt(2, dt, resources));
    expect(engines[0].calls).toContain('stop');
    expect(statusOf(off).phase).toBe('off');

    // Enable → load B in flight → disable before it resolves → B arrives late: stopped, never attached.
    handlers.process({ enabled: true, playing: true }, ctxAt(3, dt, resources));
    handlers.process({ enabled: false }, ctxAt(4, dt, resources));
    resolvers[1](new MockEngine());
    await flush();
    expect(engines[1].calls).toEqual(['stop']);
    expect(statusOf(handlers.process({ enabled: false }, ctxAt(5, dt, resources))).phase).toBe('off');

    // Re-enable: a fresh load C, which plays from a clean diff (prompts pushed again).
    handlers.process({ enabled: true, playing: true, steer: steer(1, 120) }, ctxAt(6, dt, resources));
    resolvers[2](new MockEngine());
    await flush();
    handlers.process({ enabled: true, playing: true, steer: steer(1, 120) }, ctxAt(7, dt, resources));
    await flush();
    handlers.process({ enabled: true, playing: true, steer: steer(1, 120) }, ctxAt(10, dt, resources));
    expect(engines[2].calls).toContain('play');
    expect(engines[2].calls).toContain('setWeightedPrompts');
    expect(resolvers).toHaveLength(3);
  });

  it('dispose() stops a held engine', async () => {
    const engine = new MockEngine();
    const handlers = lyriaNode.make(lyriaNode.params.parse({}));
    handlers.process({ enabled: true }, ctxAt(0, 0.1, { generativeEngine: engine }));
    await flush();
    handlers.dispose?.();
    expect(engine.calls).toContain('stop');
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
    // 'enabled' / 'playing' are unconnected (default false) → lyria idles but the graph runs.
    expect(() => {
      for (let i = 0; i < 10; i++) eng.tick();
    }).not.toThrow();
    const steers = rec.values('ind.steer') as GenerativeSteer[];
    expect(steers[5].prompts[0].text).toBe('pads');
    expect(steers[5].config.bpm).toBeGreaterThanOrEqual(80);
    const statuses = rec.values('gen.status') as GenerativeStatus[];
    expect(statuses[5].phase).toBe('off');
    expect(engine.calls).toEqual([]);
  });

  it('the vendor SDK is never statically re-exported by the registries (the bundle-split guard)', () => {
    // A static re-export of `lyria_engine` from either registry module puts
    // `@google/genai` in the main bundle for every player (#188). Only the node's
    // dynamic import() may reach it.
    for (const f of ['src/nodes/index.ts', 'src/nodes/browser.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} must not statically import the Lyria engine`).not.toMatch(/from ['"].*lyria_engine['"]/);
      expect(src).not.toMatch(/from ['"]@google\/genai['"]/);
    }
    const node = readFileSync('src/nodes/output/lyria.ts', 'utf8');
    expect(node).toMatch(/await import\(['"]\.\/lyria_engine['"]\)/);
    expect(node).not.toMatch(/^import .* from ['"]\.\/lyria_engine['"]/m);
  });
});
