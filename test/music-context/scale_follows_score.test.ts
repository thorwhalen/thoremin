/**
 * The acceptance of the musical context (#934): a MusicXML piece that modulates switches the
 * instrument's scale on the bar line. The composed graph's own nodes and edges are run headless (the
 * bridge, the `music-context` node and the `music-scale` interposer that rule 6 of `composeGraph`
 * stands on the bridge's scale ports), with a stand-in for the conductor's clock playing the
 * generated study (C major, G major from bar 5 at 10 s, F major from bar 9 at 20 s; 96 bpm), at
 * 60 Hz and at a 30 fps camera's ragged ticks. The scale every consumer reads must be the old key on
 * the last tick before each bar line and the new one on the first tick at or after it; and, since
 * nothing is predicted, a clock that waits just short of a bar line, jumps back, or crosses a tempo
 * change never switches early.
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
import type { ScoreDoc } from '@thoremin/sdk/score/schema';
import type { ActiveContext, MusicChordReading, MusicContextStatus } from '@thoremin/sdk/context/reading';
import { chordScaleInKey, dialsInKey, scaleInKey, scalePorts, scalePortsInKey } from '@thoremin/sdk/context/scale';
import { MUSIC } from '../helpers/extensions';

const STUDY = join(__dirname, '..', '..', 'public', 'scores', 'modulation-study.musicxml');
const BPM = 96;
const BAR_5 = 10;
const BAR_9 = 20;
const study = (): ScoreDoc => musicxmlToScoreDoc(new Uint8Array(readFileSync(STUDY)));

/** The beat a clock stands at, given the tick's time. */
type Script = (t: number) => { beat: number; state: MusicalTime['state']; tempo?: number };
const SCRIPTS: Record<string, Script> = {
  steady: (t) => ({ beat: (t * BPM) / 60, state: 'running' }),
  // A conductor waiting for the downbeat of bar 5: running, held just short of beat 16 from 9.9 s to 11 s.
  waiting: (t) => ({ beat: t < 9.9 ? (t * BPM) / 60 : t < 11 ? Math.min((t * BPM) / 60, 16 - 1e-3) : 16 + ((t - 11) * BPM) / 60, state: 'running' }),
  // A jump back to the top at 12 s (a restart), from bar 5's key to bar 1's.
  restart: (t) => ({ beat: t < 12 ? (t * BPM) / 60 : ((t - 12) * BPM) / 60, state: 'running' }),
  // Held in bar 6 (a fermata).
  held: () => ({ beat: 21, state: 'hold', tempo: 0 }),
};

/** The conductor's clock, as a node: its beat by a script of the tick's time. */
const clockNode = defineNode<{ script: string }>({
  type: 'test-conductor-clock',
  title: 'Test clock',
  description: 'A scripted musical time.',
  inputs: [],
  outputs: [{ name: 'time', kind: 'musical-time' }],
  params: z.object({ script: z.string().default('steady') }),
  make: (p) => ({
    process: (_i, ctx) => {
      const { beat, state, tempo = BPM } = SCRIPTS[p.script](ctx.time);
      const time: MusicalTime = { t: ctx.time, beat, phase: beat % 1, tempo, period: 60 / BPM, confidence: 1, nextBeatAt: ctx.time + (1 - (beat % 1)) * (60 / BPM), beatsPerBar: 4, beatInBar: Math.floor(beat) % 4, state, anchors: 8 };
      return { time };
    },
  }),
});

const KEEP = ['ui', 'musicContext', 'musicScale', 'map'];

/** The composed graph for an instrument whose scale follows the music, cut to the bridge, the
 *  node, the interposer and one consumer (the voice mapping), plus the clock on the conductor's id. */
function spec(registry: ReturnType<typeof createAppRegistry>, script: string): GraphSpec {
  const ids = branchIdsFor({ musicContext: { scaleFrom: 'music' } });
  expect(ids).toContain('music-context');
  const { spec: s } = composeInstrumentGraph(ids, { source: 'synthetic-hands' }, registry);
  // Rule 6: the voice mapping reads the interposer's scales, the interposer the bridge's.
  expect(s.edges.find((e) => e.to.node === 'map' && e.to.port === 'scaleRight')?.from).toEqual({ node: 'musicScale', port: 'scaleRight' });
  expect(s.edges.find((e) => e.to.node === 'musicScale' && e.to.port === 'scaleRight')?.from).toEqual({ node: 'ui', port: 'scaleRight' });
  expect(s.edges.filter((e) => e.from.node === 'ui' && e.from.port === 'chordSpec').every((e) => e.to.node === 'musicScale')).toBe(true);
  return {
    nodes: [...s.nodes.filter((n) => KEEP.includes(n.id) && n.id !== 'map'), { id: 'conductor', type: 'test-conductor-clock', params: { script } }],
    edges: [...s.edges.filter((e) => KEEP.includes(e.from.node) && KEEP.includes(e.to.node) && e.to.node !== 'map'), { from: { node: 'conductor', port: 'time' }, to: { node: 'musicContext', port: 'conductorTime' } }],
  };
}

const pcs = (scale: readonly number[]) => [...new Set(scale.map((n) => ((n % 12) + 12) % 12))].sort((a, b) => a - b);
const same = (a: readonly number[], b: readonly number[]) => JSON.stringify(a) === JSON.stringify(b);
const C_PENTA = [0, 2, 4, 7, 9];
const G_PENTA = [2, 4, 7, 9, 11];
const F_PENTA = [0, 2, 5, 7, 9];

interface Tick {
  t: number;
  scale: number[];
  chord: MusicChordReading | undefined;
  status: MusicContextStatus | undefined;
}

async function play(times: readonly number[], { scaleFrom = 'music', fit = 'flavour', script = 'steady', doc = study() }: { scaleFrom?: string; fit?: string; script?: string; doc?: ScoreDoc } = {}): Promise<Tick[]> {
  const registry = createAppRegistry();
  registry.register(clockNode);
  const active: ActiveContext = { context: contextFromScore(doc), clock: 'conductor' };
  const base = useControls.getState();
  // The dials: a C major pentatonic, the music owning the scale.
  const snapshot = { ...base, right: { ...base.right, root: 0, type: 'pentatonic' as const }, left: { ...base.left, root: 0, type: 'pentatonic' as const }, musicContext: { scaleFrom, fit, lookAheadBeats: 1, horizonBeats: 4 }, musicContextActive: active };
  const engine = new Engine(spec(registry, script), registry, { resources: { controls: () => snapshot } });
  await engine.init();
  return times.map((t) => {
    engine.tick(t);
    return {
      t,
      scale: pcs((engine.getOutput('musicScale', 'scaleRight') as number[] | undefined) ?? []),
      chord: engine.getOutput('musicContext', 'chord') as MusicChordReading | undefined,
      status: engine.getOutput('musicContext', 'status') as MusicContextStatus | undefined,
    };
  });
}

/** Tick times from about 0 to `until` at `hz`, each moved by a jitter of up to `jitter` seconds. */
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
    expect(run.every((r) => [C_PENTA, G_PENTA, F_PENTA].some((s) => same(s, r.scale)))).toBe(true);
  });

  it("switches on the bar line at a 30 fps camera's ragged ticks too", async () => {
    const run = await play(ticks(30, 24, 0.004));
    switches(run, BAR_5, C_PENTA, G_PENTA);
    switches(run, BAR_9, G_PENTA, F_PENTA);
  });

  it("plays the key's own scale with fit = key", async () => {
    const run = await play(ticks(60, 22), { fit: 'key' });
    switches(run, BAR_9, [0, 2, 4, 6, 7, 9, 11], [0, 2, 4, 5, 7, 9, 10]);
  });

  it('never switches early while a conductor waits just short of the bar line for the downbeat', async () => {
    const run = await play(ticks(60, 12), { script: 'waiting' });
    expect(run.filter((r) => r.t < 11).every((r) => same(r.scale, C_PENTA))).toBe(true);
    expect(run.find((r) => r.t >= 11)!.scale).toEqual(G_PENTA);
  });

  it('follows a jump back to the top on the tick it happens', async () => {
    const run = await play(ticks(60, 13), { script: 'restart' });
    expect(run.filter((r) => r.t >= BAR_5 && r.t < 12).every((r) => same(r.scale, G_PENTA))).toBe(true);
    expect(run.filter((r) => r.t >= 12).every((r) => same(r.scale, C_PENTA))).toBe(true);
  });

  it('plays the music\'s key from the first tick, whatever the dials say', async () => {
    const doc = { ...study(), keys: [{ beat: 0, fifths: -3, mode: 'major' as const }] };
    const run = await play(ticks(60, 1), { doc });
    expect(run[0].scale).toEqual([0, 3, 5, 7, 10]); // E-flat major pentatonic
  });

  it('announces the next chord one beat ahead, timed to its bar line, across a tempo change', async () => {
    const run = await play(ticks(60, 11));
    const announcing = run.filter((r) => r.chord?.next?.name === 'G');
    expect(announcing.length).toBeGreaterThan(0);
    // One beat at 96 bpm is 0.625 s: the announcement starts no earlier than that before the bar.
    expect(announcing[0].t).toBeGreaterThanOrEqual(BAR_5 - 0.625 - 1e-9);
    for (const r of announcing) expect(r.chord!.next!.at).toBeCloseTo(BAR_5, 6);
    expect(run.find((r) => r.t >= BAR_5)!.chord!.name).toBe('G');
    expect(run.at(-1)!.status).toMatchObject({ active: true, source: 'score', clock: 'conductor', moving: true, key: 'G major', ownsScale: true });
    // The score halves its marked tempo at bar 5: the clock's beats are what land the chord, so the
    // announcement still says 10 s.
    const halved = await play(ticks(60, 10.2), { doc: { ...study(), tempoMap: [{ beat: 0, bpm: 96 }, { beat: 16, bpm: 48 }] } });
    for (const r of halved.filter((x) => x.chord?.next?.name === 'G')) expect(r.chord!.next!.at).toBeCloseTo(BAR_5, 6);
  });

  it('leaves the scale to the dials while they own it', async () => {
    const run = await play(ticks(60, 12), { scaleFrom: 'dials' });
    expect(run.every((r) => same(r.scale, C_PENTA))).toBe(true);
    expect(run.at(-1)!.status).toMatchObject({ key: 'G major', ownsScale: false });
  });

  it('holds where the music holds: a held clock keeps its key and announces nothing', async () => {
    const run = await play(ticks(60, 3), { script: 'held' });
    expect(run.every((r) => r.chord?.next === null)).toBe(true);
    expect(run.every((r) => same(r.scale, G_PENTA))).toBe(true);
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

  it('keeps the register and pins the chord source, and computes the ports the bridge does', () => {
    const base = useControls.getState();
    const dials = { ...base, right: { ...base.right, type: 'pentatonic' as const, baseOctave: 4 } };
    const out = dialsInKey(dials, { key: { tonic: 7, mode: 'major' }, fit: 'flavour' });
    expect(out.right).toMatchObject({ root: 7, type: 'pentatonic', baseOctave: 4, octaves: dials.right.octaves });
    expect(out.faceChord).toMatchObject({ chordSource: 'custom', chordRoot: 7, chordType: 'major' });
    expect(dials.right.root).toBe(base.right.root); // the dials are not written
    const ports = scalePortsInKey(dials, { key: { tonic: 7, mode: 'major' }, fit: 'flavour' });
    expect(ports.chordSpec).toMatchObject({ root: 7, type: 'major', baseOctave: 4 });
    expect(pcs(ports.scaleRight)).toEqual(G_PENTA);
    expect(scalePorts(dials).rightSpec).toMatchObject({ root: base.right.root, type: 'pentatonic' });
  });
});
