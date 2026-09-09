/**
 * The generative layer's switch (#141 / #188), end to end and headless: the store
 * heals a pre-#188 blob and never resumes the transport; `store-controls` emits the
 * four steer ports from the snapshot; and the REAL production graph, driven by
 * `synthetic-hands` with no camera, no audio and a mock engine factory, connects,
 * plays, pushes the starter strains and reports `active` — then stops and drops the
 * engine when the layer is switched off. This is the fixture-replay proof that a
 * player who flips the dial and presses play reaches the engine.
 */
import { describe, it, expect } from 'vitest';
import { Engine, StreamRecorder } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import type { ControlSnapshot } from '@/nodes/sources/store_controls';
import type { GenerativeConfig, GenerativeEngine, GenerativeEngineFactory, GenerativeStatus, WeightedPrompt } from '@/nodes';
import { defaultGraph, STARTER_STEER } from '@/app/graph';
import { mergeControls, useControls, toSettings } from '@/app/store';
import { DEFAULT_STEER, SettingsSchema } from '@/settings/schema';
import { settingsToLayer, layerToSettings, thoreminDials } from '@/settings/dials';

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
    this.prompts.push(p);
  }
  setConfig(c: GenerativeConfig) {
    this.configs.push(c);
  }
  resetContext() {
    this.calls.push('resetContext');
  }
  setVolume(g: number) {
    this.volumes.push(g);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the store: the steer preset field and the transient transport', () => {
  it('has the generative layer off by default, at 0.7, with the starter (empty) config', () => {
    const s = useControls.getState();
    expect(s.steer).toEqual({ enabled: false, volume: 0.7, config: DEFAULT_STEER.config });
    expect(s.steerPlaying).toBe(false);
    // The transport is not a preset field: never snapshotted, never saved with an instrument.
    expect('steerPlaying' in toSettings(s)).toBe(false);
    expect('steer' in toSettings(s)).toBe(true);
  });

  it('mergeControls heals a pre-#188 blob (no steer) and completes a partial one', () => {
    const initial = useControls.getState();
    expect(mergeControls({ masterVolume: 0.5 }, initial).steer).toEqual(DEFAULT_STEER);
    const partial = mergeControls({ steer: { enabled: true } }, initial).steer;
    expect(partial).toEqual({ enabled: true, volume: 0.7, config: DEFAULT_STEER.config });
    // A corrupt one falls back whole rather than leaving the panel a NaN slider.
    expect(mergeControls({ steer: { volume: 'loud' } }, initial).steer).toEqual(initial.steer);
  });

  it('mergeControls completes a PARTIAL steering config (the shape #202 persisted) from the default — sound-identical, and never a phantom edit', () => {
    const initial = useControls.getState();
    const healed = mergeControls({ steer: { enabled: true, volume: 0.5, config: { smoothing: 0.3, throttleSec: 0.2 } } }, initial).steer;
    expect(healed.config.smoothing).toBe(0.3); // the player's values win
    expect(healed.config.strains).toEqual(DEFAULT_STEER.config.strains); // the arrays are filled
    expect(healed.config.dials).toEqual(DEFAULT_STEER.config.dials);
  });

  it('the transport never resumes from storage, even from a hand-edited blob', () => {
    const initial = useControls.getState();
    expect(mergeControls({ steer: { enabled: true }, steerPlaying: true }, initial).steerPlaying).toBe(false);
  });

  it('setSteerPlaying / toggleSteerPlaying flip the transient flag', () => {
    useControls.getState().setSteerPlaying(true);
    expect(useControls.getState().steerPlaying).toBe(true);
    useControls.getState().toggleSteerPlaying();
    expect(useControls.getState().steerPlaying).toBe(false);
  });

  it('switching the layer OFF (through the dials → store sync) pauses the transport, so re-enabling never auto-plays', () => {
    const s = useControls.getState();
    s.applySettings({ ...toSettings(s), steer: { ...s.steer, enabled: true } });
    s.setSteerPlaying(true);
    expect(useControls.getState().steerPlaying).toBe(true);
    // Unrelated settings changes leave the transport alone...
    s.applySettings({ ...toSettings(useControls.getState()), masterVolume: 0.3 });
    expect(useControls.getState().steerPlaying).toBe(true);
    // ...switching the layer off pauses it.
    s.applySettings({ ...toSettings(useControls.getState()), steer: { ...useControls.getState().steer, enabled: false } });
    expect(useControls.getState().steerPlaying).toBe(false);
    s.applySettings({ ...toSettings(useControls.getState()), steer: { ...useControls.getState().steer, enabled: true } });
    expect(useControls.getState().steerPlaying).toBe(false);
  });

  it('the dials layer round-trips the steer field (schema ↔ flat keys), and the keys exist as dials', () => {
    const settings = SettingsSchema.parse({ ...toSettings(useControls.getState()), steer: { enabled: true, volume: 0.3, config: { smoothing: 0.5 } } });
    const layer = settingsToLayer(settings);
    expect(layer['steer.enabled']).toBe(true);
    expect(layer['steer.volume']).toBe(0.3);
    expect(layer.steerConfig).toEqual({ smoothing: 0.5 });
    expect(layerToSettings(layer as Record<string, unknown>).steer).toEqual({ enabled: true, volume: 0.3, config: { smoothing: 0.5 } });
    for (const k of ['steer.enabled', 'steer.volume', 'steerConfig']) expect(thoreminDials.keys).toContain(k);
  });
});

describe('the starter steering', () => {
  it('reads "raise the hand" as MORE (image y is 0 at the top), matching the panel copy', () => {
    for (const ref of [...STARTER_STEER.strains!, ...STARTER_STEER.dials!]) {
      if (ref.feature === 'y') {
        expect(ref.inMin).toBeGreaterThan(ref.inMax);
      }
    }
  });
});

describe('store-controls emits the steer ports', () => {
  const snapshot = (over: Partial<ControlSnapshot>): ControlSnapshot => ({
    right: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, sound: 'warmPad' },
    left: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, sound: 'glass' },
    ...over,
  });
  const tick = (c: ControlSnapshot) => {
    const reg = createAppRegistry();
    const eng = new Engine(
      { nodes: [{ id: 'ui', type: 'store-controls' }], edges: [] },
      reg,
      { resources: { controls: () => c } },
    );
    eng.tick();
    return (port: string) => eng.getOutput('ui', port);
  };

  it('defaults: off, not playing, 0.7, and no steerConfig when the snapshot has none', () => {
    const out = tick(snapshot({}));
    expect(out('steerEnabled')).toBe(false);
    expect(out('steerPlaying')).toBe(false);
    expect(out('steerVolume')).toBe(0.7);
    expect(out('steerConfig')).toBeUndefined();
  });

  it('carries the live values through', () => {
    const cfg = { strains: [{ text: 'rain', source: 'face' as const, hand: 'right' as const, feature: 'smile' as const, inMin: 0, inMax: 1, weightMin: 0, weightMax: 2 }] };
    const out = tick(snapshot({ steer: { enabled: true, volume: 0.25, config: cfg }, steerPlaying: true }));
    expect(out('steerEnabled')).toBe(true);
    expect(out('steerPlaying')).toBe(true);
    expect(out('steerVolume')).toBe(0.25);
    expect(out('steerConfig')).toBe(cfg); // same reference: the node diffs by identity
  });
});

describe('the production graph, driven headlessly through the switch', () => {
  it('enable + play reaches the engine with the starter strains, reports active, and disabling stops it', async () => {
    const control = {
      right: { root: 0, type: 'pentatonic' as const, octaves: 2, baseOctave: 3, sound: 'warmPad' as const },
      left: { root: 0, type: 'pentatonic' as const, octaves: 2, baseOctave: 3, sound: 'glass' as const },
      steer: { enabled: false, volume: 0.6, config: { ...DEFAULT_STEER.config } },
      steerPlaying: false,
    };
    const engines: MockEngine[] = [];
    const factory: GenerativeEngineFactory = async () => {
      const e = new MockEngine();
      engines.push(e);
      return { resource: e };
    };
    const rec = new StreamRecorder();
    const registry = createAppRegistry();
    const eng = new Engine(defaultGraph({ source: 'synthetic-hands' }, registry), registry, {
      resources: { controls: () => control, createGenerativeEngine: factory },
      taps: [rec],
      nominalDt: 1 / 30,
    });
    const status = () => eng.getOutput('gen', 'status') as GenerativeStatus;

    // Off: the graph ticks, the branch is pure, nothing loads.
    for (let i = 0; i < 10; i++) eng.tick();
    await flush();
    expect(engines).toHaveLength(0);
    expect(status().phase).toBe('off');

    // Enable: the factory is asked once; ready, not playing.
    control.steer = { ...control.steer, enabled: true };
    eng.tick();
    await flush();
    eng.tick();
    expect(engines).toHaveLength(1);
    expect(status().phase).toBe('ready');
    expect(engines[0].volumes).toEqual([0.6]);

    // Play: connect + play, the starter strains reach the engine, status active.
    control.steerPlaying = true;
    for (let i = 0; i < 40; i++) {
      eng.tick();
      await flush();
    }
    expect(engines[0].calls.filter((c) => c === 'connect')).toHaveLength(1);
    expect(engines[0].calls.filter((c) => c === 'play')).toHaveLength(1);
    expect(status().phase).toBe('active');
    const texts = engines[0].prompts.at(-1)?.map((p) => p.text);
    expect(texts).toEqual(STARTER_STEER.strains!.map((s) => s.text));
    expect(engines[0].configs.at(-1)).toHaveProperty('brightness');
    // The steer stream is recorded like any other edge (a `generate` edge, tapped).
    const steers = rec.values('imap.steer') as Array<{ prompts: WeightedPrompt[] }>;
    expect(steers.length).toBeGreaterThan(10);

    // A live steering config replaces the strains without a rebuild.
    control.steer = { ...control.steer, config: { ...DEFAULT_STEER.config, strains: [{ text: 'rain on glass', source: 'hand', hand: 'right', feature: 'openness', inMin: 0, inMax: 1, weightMin: 0, weightMax: 1 }] } };
    for (let i = 0; i < 20; i++) {
      eng.tick();
      await flush();
    }
    expect(engines[0].prompts.at(-1)?.map((p) => p.text)).toEqual(['rain on glass']);

    // Pause: the engine pauses, status back to ready.
    control.steerPlaying = false;
    eng.tick();
    await flush();
    expect(engines[0].calls).toContain('pause');
    expect(status().phase).toBe('ready');

    // Disable: the engine is stopped and dropped, status off, one engine ever built.
    control.steer = { ...control.steer, enabled: false };
    eng.tick();
    await flush();
    expect(engines[0].calls).toContain('stop');
    expect(status().phase).toBe('off');
    expect(engines).toHaveLength(1);
    eng.dispose();
  });
});
