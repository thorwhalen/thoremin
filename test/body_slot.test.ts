/**
 * The `body` slot (#186): the second slot with real candidates, and the first
 * camera branch that is BOTH swappable and gated. Mirrors `test/source_slot.test.ts`
 * clause for clause — contract, rejection, URL reachability, running-engine swap,
 * the camera-free payoff, determinism — because the body slot exists so the whole
 * body path can be exercised with no camera and no model.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Engine, createRegistry, defineNode } from '@/dag';
import { SLOTS, defaultGraph, parseSlotSelection, resolveSlot, sourceNeedsVideo } from '@/app/graph';
import { createAppRegistry, BROWSER_NODES } from '@/nodes/browser';
import { CORE_NODES } from '@/nodes';
import { BODY_SLOT_CONTRACT, BODY_SLOT_OUTPUT } from '@/nodes/sources/body_contract';
import { BLM, BODY_LANDMARK_COUNT, BodyFrameSchema, EMPTY_BODY_FRAME, type BodyFrame } from '@/nodes/domain';

const appRegistry = () => createAppRegistry();

/** Where each candidate's implementation lives, for the determinism guard below. */
const CANDIDATE_SOURCES: Record<string, string> = {
  'webcam-body': 'src/nodes/sources/webcam_body.ts',
  'synthetic-body': 'src/nodes/sources/synthetic_body.ts',
  'replay-body': 'src/nodes/sources/replay_body.ts',
};

describe('the body slot contract', () => {
  it('every declared candidate really satisfies it', () => {
    const reg = appRegistry();
    for (const type of SLOTS.body.candidates) {
      const def = reg.get(type);
      expect(def.roles, `${type} must carry the source role`).toContain('source');
      const out = def.outputs.find((p) => p.name === BODY_SLOT_OUTPUT.name);
      expect(out, `${type} must emit "${BODY_SLOT_OUTPUT.name}"`).toBeTruthy();
      expect(out!.kind).toBe(BODY_SLOT_OUTPUT.kind);
      expect(out!.schema, `${type}'s body port must carry the contract schema`).toBe(BodyFrameSchema);
      expect(def.inputs).toEqual([]);
    }
    expect(BODY_SLOT_CONTRACT.requiredInputs).toEqual([]);
    expect(SLOTS.body.default).toBe('webcam-body');
    expect(SLOTS.body.candidates.length).toBeGreaterThan(1);
  });

  it('rejects a node that is role:source but emits hands, not a body', () => {
    const reg = appRegistry();
    const warnings: string[] = [];
    expect(resolveSlot('body', { body: 'synthetic-hands' }, reg, (m) => warnings.push(m))).toBe('webcam-body');
    expect(warnings[0]).toContain('has no output port "body"');
  });

  it('rejects a wrong-kind body port', () => {
    const reg = appRegistry();
    reg.register(
      defineNode({
        type: 'bogus-body',
        roles: ['source'],
        inputs: [],
        outputs: [{ name: 'body', kind: 'not-a-frame' }],
        process: () => ({ body: null }),
      }),
    );
    const warnings: string[] = [];
    expect(resolveSlot('body', { body: 'bogus-body' }, reg, (m) => warnings.push(m))).toBe('webcam-body');
    expect(warnings[0]).toContain('not "body-frame"');
  });

  it('is reachable from the URL, independently of the hands slot', () => {
    expect(parseSlotSelection('?slot.body=synthetic-body')).toEqual({ body: 'synthetic-body' });
    expect(parseSlotSelection('?slot.body=replay-body&slot.source=synthetic-hands')).toEqual({
      body: 'replay-body',
      source: 'synthetic-hands',
    });
  });

  it('does not decide whether the host acquires a camera — that stays the hands slot’s call', () => {
    const reg = appRegistry();
    expect(sourceNeedsVideo({ body: 'synthetic-body' }, reg)).toBe(true);
    expect(sourceNeedsVideo({ body: 'synthetic-body', source: 'synthetic-hands' }, reg)).toBe(false);
  });
});

describe('swapping the body source in the real graph', () => {
  it('replaces only the body node and leaves every edge valid', () => {
    const reg = appRegistry();
    const spec = defaultGraph({ body: 'synthetic-body' }, reg);
    expect(spec.nodes.find((n) => n.id === 'camBody')?.type).toBe('synthetic-body');
    expect(spec.nodes.find((n) => n.id === 'cam')?.type).toBe('webcam-hands');
    expect(() => new Engine(spec, reg)).not.toThrow();
    expect(spec.nodes).toHaveLength(defaultGraph().nodes.length);
    expect(spec.edges).toEqual(defaultGraph().edges);
  });

  it('swaps on a RUNNING engine, keeping the hands and face models', async () => {
    const reg = appRegistry();
    const engine = new Engine(defaultGraph(), reg);
    const change = await engine.applyGraph(defaultGraph({ body: 'synthetic-body' }, reg), reg);
    expect(change.replaced).toEqual(['camBody']);
    expect(change.added).toEqual([]);
    expect(change.removed).toEqual([]);
    expect(change.kept).toContain('cam');
    expect(change.kept).toContain('camFace');
  });
});

describe('the payoff: the whole body path runs with no camera', () => {
  it('a synthetic body drives the real graph to a present, well-formed frame, headlessly', () => {
    const reg = appRegistry();
    const engine = new Engine(defaultGraph({ source: 'synthetic-hands', body: 'synthetic-body' }, reg), reg, {
      validatePorts: true,
    });
    for (let i = 0; i < 30; i++) engine.tick(i / 30);
    const frame = engine.getOutput('camBody', 'body') as BodyFrame;
    expect(frame.present).toBe(true);
    expect(frame.landmarks).toHaveLength(BODY_LANDMARK_COUNT);
    expect(frame.world).toHaveLength(BODY_LANDMARK_COUNT);
    expect(frame.visibility).toHaveLength(BODY_LANDMARK_COUNT);
    // Upright and facing the camera: shoulders above hips, subject's left at larger x.
    expect(frame.landmarks[BLM.left_shoulder].y).toBeLessThan(frame.landmarks[BLM.left_hip].y);
    expect(frame.landmarks[BLM.left_shoulder].x).toBeGreaterThan(frame.landmarks[BLM.right_shoulder].x);
    // Hip-centred world coordinates.
    const hipMid = {
      x: (frame.world![BLM.left_hip].x + frame.world![BLM.right_hip].x) / 2,
      y: (frame.world![BLM.left_hip].y + frame.world![BLM.right_hip].y) / 2,
    };
    expect(Math.abs(hipMid.x)).toBeLessThan(1e-9);
    expect(Math.abs(hipMid.y)).toBeLessThan(1e-9);
  });

  it('the live webcam-body node is a well-defined no-op with no camera and no dial', () => {
    // The default graph, no resources at all: the body node must emit the EMPTY frame
    // (never `undefined`) and an idle status, and must not try to load anything.
    const reg = appRegistry();
    const engine = new Engine(defaultGraph({ source: 'synthetic-hands' }, reg), reg, { validatePorts: true });
    expect(() => engine.tick()).not.toThrow();
    expect(engine.getOutput('camBody', 'body')).toEqual(EMPTY_BODY_FRAME);
    expect((engine.getOutput('camBody', 'status') as { phase: string }).phase).toBe('off');
  });

  it('a replay body with nothing to replay emits the empty frame, never nothing', () => {
    const reg = appRegistry();
    const engine = new Engine(defaultGraph({ source: 'synthetic-hands', body: 'replay-body' }, reg), reg, {
      validatePorts: true,
    });
    expect(() => engine.tick()).not.toThrow();
    expect((engine.getOutput('camBody', 'body') as BodyFrame).present).toBe(false);
  });

  it('the synthetic body bounces at its declared period (the pulse ground truth)', () => {
    // hip-mid y over one period returns to its start; over half a period it does not.
    const reg = appRegistry();
    const period = 0.5;
    const engine = new Engine(
      { nodes: [{ id: 'b', type: 'synthetic-body', params: { bouncePeriod: period } }], edges: [] },
      reg,
    );
    const hipY = (t: number) => {
      engine.tick(t);
      const f = engine.getOutput('b', 'body') as BodyFrame;
      return (f.landmarks[BLM.left_hip].y + f.landmarks[BLM.right_hip].y) / 2;
    };
    const y0 = hipY(0.1);
    const yHalf = hipY(0.1 + period / 2);
    const yFull = hipY(0.1 + period);
    expect(Math.abs(yFull - y0)).toBeLessThan(1e-6);
    expect(Math.abs(yHalf - y0)).toBeGreaterThan(1);
  });
});

describe('body source determinism (the seeded-RNG rule)', () => {
  it('the candidate table covers every declared candidate', () => {
    expect(Object.keys(CANDIDATE_SOURCES).sort()).toEqual([...SLOTS.body.candidates].sort());
  });

  const driveSource = (type: string, times: number[], params: unknown = {}): string => {
    const reg = createRegistry([...CORE_NODES, ...BROWSER_NODES]);
    const engine = new Engine({ nodes: [{ id: 's', type, params }], edges: [] }, reg, { validatePorts: true });
    const out: unknown[] = [];
    for (const t of times) {
      engine.tick(t);
      out.push(engine.getOutput('s', 'body'));
    }
    return JSON.stringify(out);
  };

  const FRAMES: BodyFrame[] = [11, 22, 33].map((w) => ({ ...EMPTY_BODY_FRAME, width: w, height: w }));
  const paramsFor = (type: string) => (type === 'replay-body' ? { frames: FRAMES } : {});

  it('BEHAVIOURAL: a finished-frame body source is a pure function of the ctx it is given', () => {
    for (const type of SLOTS.body.candidates.filter((t) => t !== SLOTS.body.default)) {
      const times = Array.from({ length: 20 }, (_, i) => i / 60);
      expect(driveSource(type, times, paramsFor(type)), `${type} is not reproducible`).toBe(
        driveSource(type, times, paramsFor(type)),
      );
    }
  });

  it('BEHAVIOURAL: a replay body ignores the clock entirely', () => {
    const fast = Array.from({ length: 12 }, (_, i) => i / 60);
    const slow = Array.from({ length: 12 }, (_, i) => 1000 + i / 5);
    expect(driveSource('replay-body', fast, { frames: FRAMES })).toBe(driveSource('replay-body', slow, { frames: FRAMES }));
  });

  it('BEHAVIOURAL: a replay body swapped into a RUNNING graph starts at frame 0', async () => {
    const reg = appRegistry();
    const engine = new Engine(defaultGraph({ source: 'synthetic-hands', body: 'synthetic-body' }, reg), reg);
    for (let i = 0; i < 50; i++) engine.tick();
    const next = defaultGraph({ source: 'synthetic-hands', body: 'replay-body' }, reg);
    next.nodes = next.nodes.map((n) => (n.id === 'camBody' ? { ...n, params: { frames: FRAMES } } : n));
    expect((await engine.applyGraph(next, reg)).replaced).toEqual(['camBody']);
    const widths: number[] = [];
    for (let i = 0; i < 4; i++) {
      engine.tick();
      widths.push((engine.getOutput('camBody', 'body') as BodyFrame).width);
    }
    expect(widths).toEqual([11, 22, 33, 33]);
  });

  it('a cheap source grep backs the behavioural checks up', () => {
    const AMBIENT = [/Math\.random/, /Date\.now/, /new Date\(/, /crypto\./];
    for (const [type, file] of Object.entries(CANDIDATE_SOURCES)) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      for (const pattern of AMBIENT) expect(src, `${type} must not use ${pattern}`).not.toMatch(pattern);
      if (type !== SLOTS.body.default) {
        expect(src, `${type} must not read the wall clock`).not.toMatch(/performance\.now/);
      }
    }
  });
});
