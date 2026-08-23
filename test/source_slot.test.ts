/**
 * The `source` slot and port conformance (issue #104 / Stream Applier M-C).
 *
 * Two halves, both of which the design doc argues for on the same grounds — that
 * "where the frames come from" should be a *selection*, not a code path:
 *
 *  1. **The slot.** Its candidates are the finished-frame emitters only. A file
 *     or stream feeding a `<video>` is host-side (`sourceSpec.ts`, M-A), because
 *     `webcam-hands` does the identical job whatever produced the pixels — and
 *     because the batch path runs in Node, where a node that so much as imports
 *     the MediaPipe WASM runtime cannot load. So a finished-frame origin has to
 *     be a different node type; that is what makes this a slot and not a flag.
 *
 *  2. **Port conformance.** `PortSpec.kind` was always advisory. A slot needs
 *     more than a label: the payoff below (the whole instrument running from a
 *     synthetic source, in Node, with no camera) is only trustworthy if a source
 *     that emits a malformed frame — or, the failure that actually happens,
 *     *nothing at all* — fails loudly at the source rather than surfacing three
 *     nodes downstream as a wrong note.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { Engine, createRegistry, defineNode, runHeadless, type GraphSpec } from '../src/dag';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAppRegistry, BROWSER_NODES } from '@/nodes/browser';
import { CORE_NODES } from '@/nodes';
import { SLOTS, resolveSlot, defaultGraph, parseSlotSelection } from '@/app/graph';
import { SOURCE_SLOT_CONTRACT, SOURCE_SLOT_OUTPUT } from '@/nodes/sources/source_contract';
import { HandsFrameSchema } from '@/nodes/domain';
import type { SynthParams, HandsFrame } from '@/nodes';

const appRegistry = () => createAppRegistry();

/** Where each candidate's implementation lives, for the determinism guard below. */
const CANDIDATE_SOURCES: Record<string, string> = {
  'webcam-hands': 'src/nodes/sources/webcam_hands.ts',
  'synthetic-hands': 'src/nodes/sources/synthetic_hands.ts',
  'replay-hands': 'src/nodes/sources/replay_hands.ts',
};

describe('the source slot contract', () => {
  it('every declared candidate really satisfies it', () => {
    const reg = appRegistry();
    for (const type of SLOTS.source.candidates) {
      const def = reg.get(type);
      expect(def.roles, `${type} must carry the source role`).toContain('source');
      const out = def.outputs.find((p) => p.name === SOURCE_SLOT_OUTPUT.name);
      expect(out, `${type} must emit "${SOURCE_SLOT_OUTPUT.name}"`).toBeTruthy();
      expect(out!.kind).toBe(SOURCE_SLOT_OUTPUT.kind);
      // The schema is what makes this contract checkable rather than nominal.
      expect(out!.schema, `${type}'s hands port must carry the contract schema`).toBe(HandsFrameSchema);
      // Sources are zero-input by definition; the slot's risk is all on the output.
      expect(def.inputs).toEqual([]);
    }
    expect(SOURCE_SLOT_CONTRACT.requiredInputs).toEqual([]);
  });

  it('has more than one real implementation, unlike the mapping slot', () => {
    expect(SLOTS.source.default).toBe('webcam-hands');
    expect(SLOTS.source.candidates.length).toBeGreaterThan(1);
  });

  it('rejects a node that is role:source but emits the wrong thing', () => {
    const reg = appRegistry();
    const warnings: string[] = [];
    // store-controls carries role 'source' but emits control values, not frames.
    expect(resolveSlot('source', { source: 'store-controls' }, reg, (m) => warnings.push(m))).toBe(
      'webcam-hands',
    );
    expect(warnings[0]).toContain('has no output port "hands"');
  });

  it('rejects a wrong-kind hands port', () => {
    const reg = appRegistry();
    reg.register(
      defineNode({
        type: 'bogus-source',
        roles: ['source'],
        inputs: [],
        outputs: [{ name: 'hands', kind: 'not-a-frame' }],
        process: () => ({ hands: null }),
      }),
    );
    const warnings: string[] = [];
    expect(resolveSlot('source', { source: 'bogus-source' }, reg, (m) => warnings.push(m))).toBe(
      'webcam-hands',
    );
    expect(warnings[0]).toContain('not "hands-frame"');
  });

  it('is reachable from the URL like every other slot', () => {
    expect(parseSlotSelection('?slot.source=synthetic-hands')).toEqual({ source: 'synthetic-hands' });
    expect(parseSlotSelection('?slot.source=replay-hands&slot.mapping=voice-mapping')).toEqual({
      source: 'replay-hands',
      mapping: 'voice-mapping',
    });
  });
});

describe('swapping the source in the real graph', () => {
  it('replaces only the source node and leaves every edge valid', () => {
    const reg = appRegistry();
    const spec = defaultGraph({ source: 'synthetic-hands' }, reg);
    expect(spec.nodes.find((n) => n.id === 'cam')?.type).toBe('synthetic-hands');
    // Its MediaPipe params are dropped: they mean nothing to a synthetic source.
    expect(spec.nodes.find((n) => n.id === 'cam')?.params).toEqual({});
    expect(() => new Engine(spec, reg)).not.toThrow();
    // Same node count, same edges — the swap is edge-stable by contract.
    expect(spec.nodes).toHaveLength(defaultGraph().nodes.length);
    expect(spec.edges).toEqual(defaultGraph().edges);
  });

  it('is byte-identical to the default when the default is selected explicitly', () => {
    expect(defaultGraph({ source: 'webcam-hands' }, appRegistry())).toEqual(defaultGraph());
  });

  it('swaps on a RUNNING engine, keeping every other node (#51)', async () => {
    const reg = appRegistry();
    const engine = new Engine(defaultGraph(), reg);
    const change = await engine.applyGraph(defaultGraph({ source: 'synthetic-hands' }, reg), reg);
    expect(change.replaced).toEqual(['cam']);
    expect(change.added).toEqual([]);
    expect(change.removed).toEqual([]);
    expect(change.rewired).toBe(false);
    expect(change.kept).toContain('camFace'); // the face model is NOT reloaded
    expect(change.kept).toContain('synth');
  });
});

describe('the payoff: the whole instrument runs with no camera', () => {
  it('a synthetic source drives the real graph to sounding voices, headlessly', () => {
    // No DOM, no MediaPipe, no camera. `init()` is deliberately not called (the
    // browser nodes lazy-load their models there); every node the synthetic path
    // touches works without it, which is the point of the finished-frame origin.
    const reg = appRegistry();
    const engine = new Engine(defaultGraph({ source: 'synthetic-hands' }, reg), reg, {
      validatePorts: true,
    });
    for (let i = 0; i < 30; i++) engine.tick();

    const hands = engine.getOutput('cam', 'hands') as HandsFrame;
    expect(HandsFrameSchema.safeParse(hands).success).toBe(true);
    expect(hands.hands).toHaveLength(1);

    const params = engine.getOutput('merge', 'params') as SynthParams;
    expect(params.voices.length).toBeGreaterThan(0);
    expect(params.voices[0].freq).toBeGreaterThan(0);
  });

  it('a replay source reproduces a recorded frame stream exactly', () => {
    const reg = appRegistry();
    const frames: HandsFrame[] = [
      { width: 10, height: 10, hands: [] },
      { width: 20, height: 20, hands: [] },
      { width: 30, height: 30, hands: [] },
    ];
    const spec = defaultGraph({ source: 'replay-hands' }, reg);
    spec.nodes = spec.nodes.map((n) => (n.id === 'cam' ? { ...n, params: { frames } } : n));
    const engine = new Engine(spec, reg, { validatePorts: true });

    const widths: number[] = [];
    for (let i = 0; i < 5; i++) {
      engine.tick();
      widths.push((engine.getOutput('cam', 'hands') as HandsFrame).width);
    }
    // Holds the last frame past the end (loop defaults off).
    expect(widths).toEqual([10, 20, 30, 30, 30]);
  });

  it('a replay source with nothing to replay emits an EMPTY frame, never undefined', () => {
    // Emitting nothing is the exact failure the schema exists to catch, so the
    // node must have a well-defined "no hands" answer of its own.
    const reg = appRegistry();
    const engine = new Engine(defaultGraph({ source: 'replay-hands' }, reg), reg, { validatePorts: true });
    expect(() => engine.tick()).not.toThrow();
    expect((engine.getOutput('cam', 'hands') as HandsFrame).hands).toEqual([]);
  });
});

// ---- port conformance ------------------------------------------------------

describe('port conformance (PortSpec.schema)', () => {
  const checked = defineNode({
    type: 'checked-source',
    roles: ['source'],
    inputs: [],
    outputs: [SOURCE_SLOT_OUTPUT],
    params: z.object({ emit: z.enum(['good', 'malformed', 'nothing']).default('good') }),
    process: (_i, p) => {
      if (p.emit === 'nothing') return {};
      if (p.emit === 'malformed') return { hands: { width: 'wide', hands: [] } };
      return { hands: { width: 1, height: 1, hands: [] } };
    },
  });
  const reg = () => createRegistry([checked]);
  const spec = (emit: string): GraphSpec => ({ nodes: [{ id: 's', type: 'checked-source', params: { emit } }], edges: [] });

  it('passes a schema-valid value through', () => {
    const engine = new Engine(spec('good'), reg(), { validatePorts: true });
    expect(() => engine.tick()).not.toThrow();
  });

  it('trips on a malformed value, naming the node, the port and the tick', () => {
    const engine = new Engine(spec('malformed'), reg(), { validatePorts: true });
    expect(() => engine.tick()).toThrow(/node "s" \(checked-source\).*output port "hands" at tick 0/s);
  });

  it('trips when the node emits NOTHING — the failure a type system cannot catch', () => {
    const engine = new Engine(spec('nothing'), reg(), { validatePorts: true });
    expect(() => engine.tick()).toThrow(/emitted nothing \(undefined\)/);
  });

  it('is OFF by default, so the live 60fps path pays nothing for it', () => {
    const engine = new Engine(spec('nothing'), reg());
    expect(() => engine.tick()).not.toThrow();
    expect(engine.getOutput('s', 'hands')).toBeUndefined();
  });

  it('runHeadless turns it ON, so a fixture is never recorded from a bad frame', async () => {
    await expect(runHeadless(spec('nothing'), reg(), { ticks: 1 })).rejects.toThrow(
      /emitted nothing \(undefined\)/,
    );
    // ...and can be opted out of explicitly.
    await expect(
      runHeadless(spec('nothing'), reg(), { ticks: 1, validatePorts: false }),
    ).resolves.toBeTruthy();
  });

  it('ignores ports that declare no schema (every existing node)', () => {
    const plain = defineNode({
      type: 'plain',
      inputs: [],
      outputs: [{ name: 'v', kind: 'number' }],
      process: () => ({}), // emits nothing, and that is allowed without a schema
    });
    const engine = new Engine({ nodes: [{ id: 'p', type: 'plain' }], edges: [] }, createRegistry([plain]), {
      validatePorts: true,
    });
    expect(() => engine.tick()).not.toThrow();
  });

  it('accepts an explicitly optional schema emitting nothing', () => {
    const maybe = defineNode({
      type: 'maybe',
      inputs: [],
      outputs: [{ name: 'v', kind: 'number', schema: z.number().optional() }],
      process: () => ({}),
    });
    const engine = new Engine({ nodes: [{ id: 'm', type: 'maybe' }], edges: [] }, createRegistry([maybe]), {
      validatePorts: true,
    });
    expect(() => engine.tick()).not.toThrow();
  });

  it('the real graph passes conformance on the camera-free path', () => {
    const reg = appRegistry();
    const engine = new Engine(defaultGraph({ source: 'synthetic-hands' }, reg), reg, { validatePorts: true });
    expect(() => {
      for (let i = 0; i < 10; i++) engine.tick();
    }).not.toThrow();
  });
});

// ---- determinism -----------------------------------------------------------

describe('source determinism (the seeded-RNG rule)', () => {
  it('the candidate table covers every declared candidate', () => {
    expect(Object.keys(CANDIDATE_SOURCES).sort()).toEqual([...SLOTS.source.candidates].sort());
  });

  it('no source-slot candidate reaches for Math.random or Date.now', () => {
    // A recording is only worth keeping if replaying it reproduces the run. Any
    // randomness in a generator source must come from `seed + ctx.tick`, never an
    // ambient RNG, and no source may read the wall clock for its VALUES.
    for (const [type, file] of Object.entries(CANDIDATE_SOURCES)) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(src, `${type} must not use Math.random`).not.toMatch(/Math\.random/);
      expect(src, `${type} must not use Date.now`).not.toMatch(/Date\.now/);
    }
  });

  it('the finished-frame candidates read no clock at all — their output is a function of ctx', () => {
    // webcam-hands is exempt and must stay so: MediaPipe's detectForVideo
    // REQUIRES a strictly-increasing timestamp, and performance.now() is it. The
    // exemption is named here rather than left implicit.
    const finishedFrame = SLOTS.source.candidates.filter((t) => t !== SLOTS.source.default);
    expect(finishedFrame.length).toBeGreaterThan(0);
    for (const type of finishedFrame) {
      const src = readFileSync(resolve(process.cwd(), CANDIDATE_SOURCES[type]), 'utf8');
      expect(src, `${type} must not read a clock`).not.toMatch(/performance\.now/);
    }
  });

  it('a synthetic source replays identically from the same tick sequence', () => {
    const reg = createRegistry([...CORE_NODES, ...BROWSER_NODES]);
    const run = () => {
      const engine = new Engine(
        { nodes: [{ id: 's', type: 'synthetic-hands' }], edges: [] },
        reg,
        { validatePorts: true },
      );
      const out: number[] = [];
      for (let i = 0; i < 20; i++) {
        engine.tick();
        out.push((engine.getOutput('s', 'hands') as HandsFrame).hands[0].keypoints[0].x);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('slot governance', () => {
  it('a bad source selection warns and falls back so the app still starts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spec = defaultGraph(parseSlotSelection('?slot.source=nonesuch'), appRegistry());
    expect(spec.nodes.find((n) => n.id === 'cam')?.type).toBe('webcam-hands');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
