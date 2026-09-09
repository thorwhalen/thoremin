/**
 * Boundary B: accelerated or slowed playback MUTES real-time output (#101 M-G).
 *
 * Control-rate params scale for free — a node reads `ctx.time` and every mapping
 * follows. Audio does not: a Web Audio graph rides `AudioContext.currentTime`, which is
 * wall time and cannot be multiplied. So an engine at 2x driving a live synth does not
 * make "the same music, faster"; it slides the control stream underneath oscillators
 * that keep running in real time.
 *
 * The design's rule is *never silently pitch-shift*. These tests pin the mechanism, and
 * the last one pins the thing a mechanism cannot: that a **future** node cannot forget.
 */
import { describe, it, expect } from 'vitest';
import {
  Applier,
  BatchClock,
  RealtimeClock,
  Engine,
  createRegistry,
  defineNode,
  realtimeOutputAllowed,
  TIME_SCALE_KEY,
  type NodeContext,
} from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctxWith = (resources: Record<string, unknown>) =>
  ({ tick: 0, time: 0, dt: 0, resources } as unknown as NodeContext);

describe('realtimeOutputAllowed', () => {
  it('allows real time', () => {
    expect(realtimeOutputAllowed(ctxWith({ [TIME_SCALE_KEY]: 1 }))).toBe(true);
  });

  it('refuses any other scale, faster OR slower', () => {
    for (const s of [2, 0.5, 4, 0.25]) {
      expect(realtimeOutputAllowed(ctxWith({ [TIME_SCALE_KEY]: s }))).toBe(false);
    }
  });

  it('ALLOWS an absent scale — absence is not "not real time"', () => {
    // Load-bearing, and the reason is compatibility rather than safety: `replayNode`
    // passes whatever a test hands it (usually nothing), and a batch run has no
    // AudioContext so the synth already self-no-ops. Muting on absence would change
    // nothing about safety and would break every existing node test.
    expect(realtimeOutputAllowed(ctxWith({}))).toBe(true);
    expect(realtimeOutputAllowed({ tick: 0, time: 0, dt: 0 } as unknown as NodeContext)).toBe(true);
  });
});

describe('the clocks declare their own scale', () => {
  it('a RealtimeClock reports its speed', () => {
    expect(new RealtimeClock({ now: () => 0, schedule: () => {} }).timeScale).toBe(1);
    expect(new RealtimeClock({ speed: 2, now: () => 0, schedule: () => {} }).timeScale).toBe(2);
  });

  it('a BatchClock reports UNDEFINED, not 1 — it has no wall-clock relation at all', () => {
    // Saying 1 would be a lie a future consumer could act on: a batch run is not
    // "real time", it is unrelated to time.
    expect(new BatchClock(1).timeScale).toBeUndefined();
  });
});

describe('the Applier publishes the scale where nodes can see it', () => {
  // NOTE the signature: a PURE node's process is `(inputs, params, ctx)`, not
  // `(inputs, ctx)` — the stateful `make` form is the one that takes two. Getting it
  // wrong silently hands you `params` where `ctx` belongs, so `ctx.resources` is
  // undefined and every resource-gated check reads as "absent" — which for this helper
  // means "allowed": the test passes while proving nothing. It did, until it was
  // debugged by printing from inside the node.
  const probe = defineNode({
    type: 'probe-scale', roles: ['source'], params: z.object({}), inputs: [],
    outputs: [{ name: 'allowed', kind: 'any' }],
    process: (_inputs, _params, ctx) => ({ allowed: realtimeOutputAllowed(ctx) }),
  });

  /** A RealtimeClock that runs a bounded number of frames on macrotasks, then stops —
   *  paced (so `run()` resolves) with no wall-clock dependence. */
  function bounded(speed: number, frames: number) {
    let t = 0;
    let scheduled = 0;
    let ticks = 0;
    const clock = new RealtimeClock({
      speed,
      now: () => (t += 1 / 30),
      schedule: (cb) => { if (scheduled++ <= frames) setTimeout(cb, 0); },
    });
    return { clock, shouldStop: () => ticks++ >= frames };
  }

  async function run(speed: number, frames: number) {
    const registry = createRegistry([probe]);
    const seen: unknown[] = [];
    const engine = new Engine({ nodes: [{ id: 'p', type: 'probe-scale', params: {} }], edges: [] }, registry, {
      taps: [{ onValue: (k, v) => { if (k === 'p.allowed') seen.push(v); } }],
    });
    await engine.init();
    const { clock, shouldStop } = bounded(speed, frames);
    await new Applier({ engine, clock, shouldStop }).run();
    return { seen, engine };
  }

  it('publishes it onto the engine own resources object', async () => {
    const { engine } = await run(2, 2);
    expect(engine.resources[TIME_SCALE_KEY]).toBe(2);
  });

  it('a node sees real time under a speed-1 clock, and NOT under a 2x one', async () => {
    const fast = await run(1, 3);
    expect(fast.seen.length).toBeGreaterThan(0);
    expect(fast.seen.every((v) => v === true)).toBe(true);

    const scaled = await run(2, 3);
    expect(scaled.seen.length).toBeGreaterThan(0);
    expect(scaled.seen.every((v) => v === false)).toBe(true);
  });
});

describe('every node that makes real-time output honours the boundary', () => {
  // The mechanism above is only as good as its adoption, and adoption is exactly what a
  // behavioural test cannot cover for a node that does not exist yet. `roles: ['synth']`
  // is already the registry's own declaration of "this node produces real-time output",
  // so it is the honest SSOT to enumerate — a new synth node that forgets the gate fails
  // here rather than silently pitch-shifting in production. Same shape as the #147
  // structural guards.
  const registry = createAppRegistry();
  const synthNodes = registry.list().filter((d) => (d.roles ?? []).includes('synth'));

  it('finds the synth nodes (the guard is not vacuous)', () => {
    expect(synthNodes.length).toBeGreaterThanOrEqual(3);
    expect(synthNodes.map((d) => d.type).sort()).toEqual(
      expect.arrayContaining(['lyria', 'midi-out', 'webaudio-synth']),
    );
  });

  it('each one consults realtimeOutputAllowed', () => {
    const files: Record<string, string> = {
      'webaudio-synth': 'src/nodes/output/webaudio_synth.ts',
      'midi-out': 'src/nodes/output/midi_out.ts',
      lyria: 'src/nodes/output/lyria.ts',
    };
    const missingFile = synthNodes.map((d) => d.type).filter((t) => !(t in files));
    expect(
      missingFile,
      `a node with role 'synth' has no entry in this test's file map — add it, and make ` +
        `sure it honours boundary B: ${missingFile.join(', ')}`,
    ).toEqual([]);

    for (const [type, file] of Object.entries(files)) {
      const src = readFileSync(resolve(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, `${type} (${file}) does not consult realtimeOutputAllowed`).toMatch(/realtimeOutputAllowed\(/);
    }
  });
});
