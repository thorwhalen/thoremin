/**
 * Replay a hand stream through a named instrument's ACTUAL graph, headless: the seed's settings,
 * the branches the app derives from them, the graph the app composes, the replay source in the
 * source slot. What comes out is the chord the instrument has in force each frame (the shared
 * chord display, `chordSel.chord`, which every chord instrument feeds) and the pitch classes its
 * voices sound, so the stability metrics (`lib_metrics.ts`) read what a player sees and hears.
 */
import { defineNode, Engine, StreamRecorder } from '@thoremin/dag';
import { z } from 'zod';
import type { HandsFrame, SynthParams } from '@thoremin/sdk/nodes/domain';
import { createAppRegistry } from '@/nodes/browser';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import type { Settings } from '@/settings/schema';

export interface SeedRunOptions {
  /** The camera period, seconds (30 fps by default, the pipeline's measured rate). */
  dt?: number;
  /** Settings merged over the seed's, one level deep (a dial's fields over the dial's). */
  patch?: Record<string, unknown>;
  /** Extra hot-store fields (transients such as a loaded categorizer model). */
  transients?: Record<string, unknown>;
  /** Extra engine resources. */
  resources?: Record<string, unknown>;
  /** Other recorded streams to keep (`node.port`). */
  record?: string[];
  /** A recorded body stream, played by `replay-body` in the body slot (for a seed that reads the body). */
  body?: readonly unknown[];
  /** A recorded face stream, played in place of the face camera (for a seed that reads the face). */
  face?: readonly unknown[];
}

/** The face camera's stand-in: a recorded `FaceFrame` stream, one per tick (the face has no
 *  source slot, so the harness swaps the node itself). The status says ready and seen. */
const replayFaceNode = defineNode<{ frames: unknown[] }>({
  type: 'stability-replay-face',
  roles: ['source'],
  title: 'Replay face (stability harness)',
  description: 'A recorded face stream, one frame per tick, in place of the face camera.',
  inputs: [],
  outputs: [
    { name: 'face', kind: 'face-frame' },
    { name: 'status', kind: 'face-status' },
  ],
  params: z.object({ frames: z.array(z.unknown()).default([]) }) as never,
  make({ frames }) {
    let n = 0;
    return {
      process() {
        const face = frames[Math.min(n++, frames.length - 1)];
        return { face, status: { phase: 'ready', present: !!(face as { present?: boolean } | undefined)?.present } };
      },
    };
  },
});

export interface SeedRun {
  t: number[];
  /** The chord in force per frame: its pitch classes, sorted and joined (`0.4.7`), or null. */
  chord: (string | null)[];
  /** The pitch classes sounding per frame on the merged voices (gain > 0), or null for silence. */
  heard: (string | null)[];
  /** The branches the seed composed. */
  branches: string[];
  values: (key: string) => unknown[];
}

/** A chord as a key: its pitch classes, sorted and joined. */
export function chordKey(notes: readonly number[] | undefined | null): string | null {
  if (!notes || !notes.length) return null;
  return [...new Set(notes.map((n) => ((Math.round(n) % 12) + 12) % 12))].sort((a, b) => a - b).join('.');
}

const pcOfFreq = (f: number) => ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;

/** The settings a seed instrument loads, with `patch` merged over them one level deep. */
export function seedSettings(name: string, patch: Record<string, unknown> = {}): Settings {
  const seed = SEED_INSTRUMENTS.find((s) => s.name === name);
  if (!seed) throw new Error(`no seed instrument named "${name}"`);
  const s = settingsFromLayer(seed.layer) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    s[k] = v && typeof v === 'object' && !Array.isArray(v) && s[k] && typeof s[k] === 'object' ? { ...(s[k] as object), ...v } : v;
  }
  return s as unknown as Settings;
}

/** Run a seed instrument on a hand stream. */
export async function runSeed(name: string, frames: readonly HandsFrame[], opts: SeedRunOptions = {}): Promise<SeedRun> {
  const settings = seedSettings(name, opts.patch);
  const branches = branchIdsFor(settings);
  const registry = createAppRegistry();
  if (opts.face) registry.register(replayFaceNode);
  const { spec } = composeInstrumentGraph(branches, { source: 'replay-hands', ...(opts.body ? { body: 'replay-body' } : {}) }, registry);
  const cam = spec.nodes.find((n) => n.id === 'cam');
  if (!cam) throw new Error('runSeed: the composed graph has no source node "cam"');
  // Stamped with their capture time, as the live camera stamps every frame: the nodes that count
  // camera frames (a hysteresis over frames, not ticks) tell one frame from the next by its stamp.
  const dt0 = opts.dt ?? 1 / 30;
  cam.params = { frames: frames.map((f, i) => (f.t === undefined ? { ...f, t: i * dt0 } : f)) };
  if (opts.body) {
    const camBody = spec.nodes.find((n) => n.id === 'camBody');
    if (!camBody) throw new Error(`runSeed: "${name}" composes no body source to replay a body stream into`);
    camBody.params = { frames: opts.body };
  }
  if (opts.face) {
    const camFace = spec.nodes.find((n) => n.id === 'camFace');
    if (!camFace) throw new Error(`runSeed: "${name}" composes no face source to replay a face stream into`);
    camFace.type = replayFaceNode.type;
    camFace.params = { frames: opts.face };
  }
  const dt = opts.dt ?? 1 / 30;
  const snapshot = { ...settings, ...(opts.transients ?? {}) };
  // The engine ticked here rather than by `runHeadless`: a lazily loaded model (the sign
  // reader's weights) arrives on a promise, so the loop yields to the event loop after every
  // frame, as the browser's frame loop does. Every performance opens with no hand, so the model
  // is in by the time a hand appears.
  const recorder = new StreamRecorder({ only: ['chordSel.chord', 'merge.params', ...(opts.record ?? [])] });
  const engine = new Engine(spec, registry, {
    nominalDt: dt,
    validatePorts: true,
    taps: [recorder],
    resources: { controls: () => snapshot, ...(opts.resources ?? {}) },
  });
  await engine.init();
  for (let i = 0; i < frames.length; i++) {
    engine.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  engine.dispose();
  const chords = recorder.values('chordSel.chord') as (number[] | undefined)[];
  const merged = recorder.values('merge.params') as (SynthParams | undefined)[];
  const heard = merged.map((m) => {
    const pcs = (m?.voices ?? []).filter((v) => v.present && v.gain > 0 && Number.isFinite(v.freq) && v.freq > 0).map((v) => pcOfFreq(v.freq));
    return pcs.length ? [...new Set(pcs)].sort((a, b) => a - b).join('.') : null;
  });
  return {
    t: frames.map((_, i) => i * dt),
    chord: chords.map((c) => chordKey(c ?? null)),
    heard,
    branches,
    values: (key) => recorder.values(key),
  };
}
