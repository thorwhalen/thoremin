/**
 * The acceptance of the musical context (#934): a MusicXML piece that modulates switches the
 * instrument's scale on the bar line. The composed graph's own nodes and edges (the bridge, the
 * `music-context` node, the delayed edge that hands the scale back to the bridge) are run headless,
 * with a stand-in for the conductor's clock playing the generated study (C major, G major from
 * bar 5 at 10 s, F major from bar 9 at 20 s; 96 bpm), at 60 Hz and at a 30 fps camera's ragged
 * ticks. The scale must be the old key on the last tick before each bar line and the new one on the
 * first tick at or after it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { defineNode, Engine, type GraphSpec } from '@thoremin/dag';
import type { MusicalTime } from '@thoremin/ictus';
import { createAppRegistry } from '@/nodes/browser';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { useControls } from '@/app/store';
import { musicxmlToScoreDoc } from '@thoremin/music-formats/musicxml';
import { contextFromScore } from '@thoremin/sdk/context/from_score';
import type { ActiveContext, MusicChordReading, MusicContextStatus } from '@thoremin/sdk/context/reading';
import { chordScaleInKey, keyInForce, scaleInKey, type ScaleOverride } from '@thoremin/sdk/context/scale';
import { withScaleOverride } from '@/host/storeControls';
import { MUSIC } from '../helpers/extensions';

const STUDY = join(__dirname, '..', '..', 'public', 'scores', 'modulation-study.musicxml');
const BPM = 96;
const BAR_5 = 10;
const BAR_9 = 20;

/** The conductor's clock, as a node: a running beat at a steady tempo from t = 0 (or held). */
const clockNode = defineNode<{ state: string; heldBeat: number }>({
  type: 'test-conductor-clock',
  title: 'Test clock',
  description: 'A steady musical time.',
  inputs: [],
  outputs: [{ name: 'time', kind: 'musical-time' }],
  params: z.object({ state: z.string().default('running'), heldBeat: z.number().default(0) }),
  make: (p) => ({
    process: (_i, ctx) => {
      const beat = p.state === 'running' ? (ctx.time * BPM) / 60 : p.heldBeat;
      const time: MusicalTime = { t: ctx.time, beat, phase: beat % 1, tempo: BPM, period: 60 / BPM, confidence: 1, nextBeatAt: ctx.time + (1 - (beat % 1)) * (60 / BPM), beatsPerBar: 4, beatInBar: Math.floor(beat) % 4, state: p.state as MusicalTime['state'], anchors: 8 };
      return { time };
    },
  }),
});

const KEEP = ['ui', 'musicContext'];

/** The composed graph for an instrument whose scale follows the music, cut to the bridge and the
 *  node, plus the stand-in clock on the conductor's id. */
function spec(registry: ReturnType<typeof createAppRegistry>, state = 'running', heldBeat = 0): GraphSpec {
  const ids = branchIdsFor({ musicContext: { scaleFrom: 'music' } });
  expect(ids).toContain('music-context');
  const { spec: s } = composeInstrumentGraph(ids, { source: 'synthetic-hands' }, registry);
  const delayed = s.edges.find((e) => e.from.node === 'musicContext' && e.to.node === 'ui');
  expect(delayed).toMatchObject({ from: { port: 'scale' }, to: { port: 'scaleOverride' }, delayed: true });
  return {
    nodes: [...s.nodes.filter((n) => KEEP.includes(n.id)), { id: 'conductor', type: 'test-conductor-clock', params: { state, heldBeat } }],
    edges: [...s.edges.filter((e) => KEEP.includes(e.from.node) && KEEP.includes(e.to.node)), { from: { node: 'conductor', port: 'time' }, to: { node: 'musicContext', port: 'conductorTime' } }],
  };
}

const pcs = (scale: readonly number[]) => [...new Set(scale.map((n) => ((n % 12) + 12) % 12))].sort((a, b) => a - b);
const C_PENTA = [0, 2, 4, 7, 9];
const G_PENTA = [2, 4, 7, 9, 11];
const F_PENTA = [0, 2, 5, 7, 9];

interface Tick {
  t: number;
  scale: number[];
  chord: MusicChordReading | undefined;
  status: MusicContextStatus | undefined;
}

async function play(times: readonly number[], { scaleFrom = 'music', fit = 'flavour', state = 'running', heldBeat = 0 }: { scaleFrom?: string; fit?: string; state?: string; heldBeat?: number } = {}): Promise<Tick[]> {
  const registry = createAppRegistry();
  registry.register(clockNode);
  const doc = musicxmlToScoreDoc(new Uint8Array(readFileSync(STUDY)));
  const active: ActiveContext = { context: contextFromScore(doc), clock: 'conductor' };
  const base = useControls.getState();
  // The dials: a C major pentatonic (the default), the music owning the scale.
  const snapshot = { ...base, right: { ...base.right, root: 0, type: 'pentatonic' as const }, left: { ...base.left, root: 0, type: 'pentatonic' as const }, musicContext: { scaleFrom, fit, lookAheadBeats: 1, horizonBeats: 4 }, musicContextActive: active };
  const engine = new Engine(spec(registry, state, heldBeat), registry, { resources: { controls: () => snapshot } });
  await engine.init();
  return times.map((t) => {
    engine.tick(t);
    return {
      t,
      scale: pcs((engine.getOutput('ui', 'scaleRight') as number[] | undefined) ?? []),
      chord: engine.getOutput('musicContext', 'chord') as MusicChordReading | undefined,
      status: engine.getOutput('musicContext', 'status') as MusicContextStatus | undefined,
    };
  });
}

/** Tick times from 0 to `until` at `hz`, each moved by a jitter of up to `jitter` seconds. */
function ticks(hz: number, until: number, jitter = 0): number[] {
  const out: number[] = [];
  for (let i = 0, t = 0.0137; t < until; i++, t = 0.0137 + i / hz + (jitter ? jitter * Math.sin(i * 12.9898) : 0)) out.push(t);
  return out;
}

function switches(run: Tick[], at: number, before: number[], after: number[]) {
  const last = [...run].reverse().find((r) => r.t < at)!;
  const first = run.find((r) => r.t >= at)!;
  expect(last.scale, `the last tick before ${at} s (${last.t.toFixed(4)})`).toEqual(before);
  expect(first.scale, `the first tick at or after ${at} s (${first.t.toFixed(4)})`).toEqual(after);
}

describe.runIf(MUSIC)('the instrument scale follows a modulating score', () => {
  it('switches on each bar line at 60 Hz: C, then G at bar 5, then F at bar 9', async () => {
    const run = await play(ticks(60, 24));
    expect(run[0].scale).toEqual(C_PENTA);
    switches(run, BAR_5, C_PENTA, G_PENTA);
    switches(run, BAR_9, G_PENTA, F_PENTA);
    // Never a stray scale in between.
    expect(run.every((r) => [C_PENTA, G_PENTA, F_PENTA].some((s) => JSON.stringify(s) === JSON.stringify(r.scale)))).toBe(true);
  });

  it('switches on the bar line at a 30 fps camera\'s ragged ticks too', async () => {
    const run = await play(ticks(30, 24, 0.004));
    switches(run, BAR_5, C_PENTA, G_PENTA);
    switches(run, BAR_9, G_PENTA, F_PENTA);
  });

  it("plays the key's own scale with fit = key", async () => {
    const run = await play(ticks(60, 22), { fit: 'key' });
    switches(run, BAR_9, [0, 2, 4, 6, 7, 9, 11], [0, 2, 4, 5, 7, 9, 10]);
  });

  it('announces the next chord one beat ahead, timed to its bar line', async () => {
    const run = await play(ticks(60, 11));
    const announcing = run.filter((r) => r.chord?.next?.name === 'G');
    expect(announcing.length).toBeGreaterThan(0);
    // One beat at 96 bpm is 0.625 s: the announcement starts no earlier than that before the bar.
    expect(announcing[0].t).toBeGreaterThanOrEqual(BAR_5 - 0.625 - 1e-9);
    for (const r of announcing) expect(r.chord!.next!.at).toBeCloseTo(BAR_5, 6);
    expect(run.find((r) => r.t >= BAR_5)!.chord!.name).toBe('G');
    expect(run.at(-1)!.status).toMatchObject({ active: true, source: 'score', clock: 'conductor', moving: true, key: 'G major', ownsScale: true });
  });

  it('leaves the scale to the dials while they own it', async () => {
    const run = await play(ticks(60, 12), { scaleFrom: 'dials' });
    expect(run.every((r) => JSON.stringify(r.scale) === JSON.stringify(C_PENTA))).toBe(true);
    expect(run.at(-1)!.status).toMatchObject({ key: 'G major', ownsScale: false });
  });

  it('holds where the music holds: a held clock keeps its key and announces nothing', async () => {
    // Held in bar 6 (a fermata): the key of bar 6 throughout, no change timed.
    const run = await play(ticks(60, 3), { state: 'hold', heldBeat: 21 });
    expect(run.every((r) => r.chord?.next === null)).toBe(true);
    // The first tick is the dials' scale: the override reaches the bridge on the next one.
    expect(run[0].scale).toEqual(C_PENTA);
    expect(run.slice(1).every((r) => JSON.stringify(r.scale) === JSON.stringify(G_PENTA))).toBe(true);
    expect(run.at(-1)!.status).toMatchObject({ moving: false, key: 'G major', chord: 'C' });
  });
});

describe('fitting the dials to the music', () => {
  it('keeps the kind of scale in the new key, as its major or minor form', () => {
    expect(scaleInKey({ type: 'pentatonic' }, { tonic: 9, mode: 'minor' }, 'flavour')).toEqual({ root: 9, type: 'minorPentatonic' });
    expect(scaleInKey({ type: 'minorPentatonic' }, { tonic: 7, mode: 'major' }, 'flavour')).toEqual({ root: 7, type: 'pentatonic' });
    expect(scaleInKey({ type: 'blues' }, { tonic: 4, mode: 'minor' }, 'flavour')).toEqual({ root: 4, type: 'blues' });
    expect(scaleInKey({ type: 'blues' }, { tonic: 4, mode: 'major' }, 'flavour')).toEqual({ root: 4, type: 'pentatonic' });
    expect(scaleInKey({ type: 'chromatic' }, { tonic: 2, mode: 'major' }, 'flavour')).toEqual({ root: 2, type: 'chromatic' });
    expect(scaleInKey({ type: 'pentatonic' }, { tonic: 2, mode: 'minor' }, 'key')).toEqual({ root: 2, type: 'minor' });
    // A church mode as its parent major: D dorian plays C major's notes.
    expect(scaleInKey({ type: 'major' }, { tonic: 2, mode: 'dorian' }, 'key')).toEqual({ root: 0, type: 'major' });
    expect(chordScaleInKey({ tonic: 9, mode: 'minor' })).toEqual({ root: 9, type: 'minor' });
  });

  it('picks the key by the reading tick, and rewrites the snapshot without touching the register', () => {
    const o: ScaleOverride = { key: { tonic: 0, mode: 'major' }, next: { key: { tonic: 7, mode: 'major' }, at: 10 }, fit: 'flavour' };
    expect(keyInForce(o, 9.999).tonic).toBe(0);
    expect(keyInForce(o, 10).tonic).toBe(7);
    const base = useControls.getState();
    const snapshot = { ...base, right: { ...base.right, type: 'pentatonic' as const, baseOctave: 4 } };
    const out = withScaleOverride(snapshot, o, 10.01);
    expect(out.right).toMatchObject({ root: 7, type: 'pentatonic', baseOctave: 4 });
    expect(out.faceChord).toMatchObject({ chordSource: 'custom', chordRoot: 7, chordType: 'major' });
    expect(withScaleOverride(snapshot, null, 10)).toBe(snapshot);
  });
});
