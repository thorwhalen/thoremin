/**
 * The conductor reads the body (#375, body-movement A3): `conductor.source` = `body`.
 *
 * Node level: on A1's 4-pattern choir conductor (`video_body_conducting_44`, the pose
 * stream of a real conductor, its grid his own baton-hand strokes) the body conductor's
 * beat is monotone and counts about the grid's beats; `auto` follows the arm that beats,
 * right or left (the clip with its sides swapped); the source decides which input is read
 * (hands are ignored while reading the body, and the other way round); a live switch of
 * source or point keeps the beat and waits for a stroke, and a fermata held across that
 * rebuild is released by the new follower's first stroke.
 *
 * Graph level, the acceptance test: `runHeadless` over the COMPOSED instrument graph the
 * derivation gives for "conductor on, source body", with the body slot on `replay-body`
 * (what `?slot.body=replay-body` selects) and the hands on `synthetic-hands` (whose hands
 * the conductor must not read). The beat is monotone and the score sounds a note on most
 * beats, through the branch table's own edges.
 *
 * The structural guard of the shipping rule: whenever the derivation composes the
 * conductor with the source `body`, the composed graph carries `camBody.body ->
 * conductor.body`. An optional edge whose far node is absent is silently dropped, so
 * without this test a derivation that forgot the body source would leave a body
 * conductor that never hears a frame and every unit test green.
 */
import { describe, expect, it } from 'vitest';
import { replayNode, runHeadless, type GraphSpec } from '@thoremin/dag';
import { conductorNode, DEFAULT_CONDUCTOR_DIAL, SCORE_VOICE_ID_BASE, type BodyFrame, type HandsFrame, type SynthParams } from '@/nodes';
import { BLM } from '@thoremin/sdk/nodes/domain';
import { bodyChannelFrame, bodyQuantityOfMotion, conductorBodyJoints } from '@/nodes/features/conductor_body';
import { createAppRegistry } from '@/nodes/browser';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { useControls } from '@/app/store';
import { loadStream } from './helpers/fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BODY as BODY_SLICE } from './helpers/extensions';

const FPS = 30;
const CLIP = 'video_body_conducting_44';
const body = loadStream(CLIP, 'camBody.body') as BodyFrame[];
const grid = (JSON.parse(readFileSync(join(__dirname, 'fixtures', CLIP, 'meta.json'), 'utf8')) as { grid: { beats: number[] } }).grid.beats;
/** A third-person video: no selfie mirroring. */
const RECORDED = { mirrorX: false, mirrorHandedness: false };
const BODY = { enabled: true, source: 'body', ...RECORDED } as const;

const monotone = (xs: number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

/** The clip with the body's sides swapped (every `left_*` landmark for its `right_*`): the
 *  same conductor beating with his LEFT arm. */
function swapSides(frames: BodyFrame[]): BodyFrame[] {
  const names = Object.keys(BLM) as (keyof typeof BLM)[];
  const pairs = names.filter((n) => n.startsWith('left_')).map((n) => [BLM[n], BLM[n.replace('left_', 'right_') as keyof typeof BLM]] as const);
  return frames.map((f) => {
    const landmarks = [...f.landmarks];
    const visibility = [...f.visibility];
    for (const [l, r] of pairs) {
      [landmarks[l], landmarks[r]] = [landmarks[r], landmarks[l]];
      [visibility[l], visibility[r]] = [visibility[r], visibility[l]];
    }
    return { ...f, landmarks, visibility };
  });
}

describe('the body channel frame and the joints', () => {
  const f = body.find((x) => x.present)!;

  it('a fixed side names the arm channels as A2 did; auto carries both sides', () => {
    const right = bodyChannelFrame(f, 0, 'right');
    expect(Object.keys(right.channels).sort()).toEqual(['elbow', 'head', 'hips', 'trunk', 'wrist']);
    expect(right.scale).toBeGreaterThan(0);
    const auto = bodyChannelFrame(f, 0, 'auto');
    expect(Object.keys(auto.channels).sort()).toEqual(['elbow.left', 'elbow.right', 'head', 'hips', 'trunk', 'wrist.left', 'wrist.right']);
    expect(bodyChannelFrame({ ...f, present: false }, 0, 'auto').channels).toEqual({});
  });

  it('every joint a body point follows is a channel the frame carries', () => {
    for (const side of ['right', 'left', 'auto'] as const) {
      const channels = Object.keys(bodyChannelFrame(f, 0, side).channels);
      for (const point of ['impact', 'wrist', 'head', 'hips', 'com'] as const) {
        const joints = conductorBodyJoints(point, side);
        expect(joints.length).toBeGreaterThan(0);
        for (const j of joints) expect(channels).toContain(j.channel);
      }
    }
  });

  it('quantity of motion: zero for a still body, positive for a moving one, undefined without a body', () => {
    expect(bodyQuantityOfMotion(f, f, 1 / FPS)).toBe(0);
    const moving = body.slice(30).find((x) => x.present)!;
    expect(bodyQuantityOfMotion(f, moving, 1)!).toBeGreaterThan(0);
    expect(bodyQuantityOfMotion(f, { ...moving, present: false }, 1)).toBeUndefined();
  });
});

describe(`the body conductor on ${CLIP} (${grid.length} beats in the grid)`, () => {
  it('a monotone beat that counts about the grid, running most of the time', async () => {
    const h = conductorNode.make(conductorNode.params.parse(BODY));
    const outs = await replayNode(h, { body }, { dt: 1 / FPS });
    const beats = outs.map((o) => o.beat as number);
    expect(monotone(beats)).toBe(true);
    const last = beats[beats.length - 1];
    expect(last).toBeGreaterThan(grid.length * 0.85);
    expect(last).toBeLessThan(grid.length * 1.2);
    const running = outs.filter((o) => (o.time as { state: string }).state === 'running').length / outs.length;
    expect(running).toBeGreaterThan(0.8);
  });

  it('auto follows the arm that beats: the same anchors as naming the right arm', async () => {
    const anchorsFor = async (hand: 'auto' | 'right' | 'left') => {
      // The detector's arm choice, under the hand transport: the body's transport (#377)
      // gates the anchors on the pose and restarts the count on a release, and its cues
      // for `auto` read both arms by design (test/conductor_transport.test.ts).
      const h = conductorNode.make(conductorNode.params.parse({ ...BODY, bodyPoint: 'wrist', hand, transport: { rules: false } }));
      const outs = await replayNode(h, { body }, { dt: 1 / FPS });
      return (outs[outs.length - 1].time as { anchors: number }).anchors;
    };
    const auto = await anchorsFor('auto');
    expect(auto).toBe(await anchorsFor('right'));
    expect(auto).toBeGreaterThan(grid.length * 0.8);
  });

  it('auto follows a LEFT beating arm too (the clip with its sides swapped), as naming the left arm does', async () => {
    const swapped = swapSides(body);
    const run = async (hand: 'auto' | 'left' | 'right') => {
      // The detector's arm choice, under the hand transport: the body's transport (#377)
      // gates the anchors on the pose and restarts the count on a release, and its cues
      // for `auto` read both arms by design (test/conductor_transport.test.ts).
      const h = conductorNode.make(conductorNode.params.parse({ ...BODY, bodyPoint: 'wrist', hand, transport: { rules: false } }));
      const outs = await replayNode(h, { body: swapped }, { dt: 1 / FPS });
      return outs.map((o) => o.beat as number);
    };
    const auto = await run('auto');
    expect(auto).toEqual(await run('left'));
    // The arm that does not beat is not what auto followed.
    expect(auto).not.toEqual(await run('right'));
    expect(auto[auto.length - 1]).toBeGreaterThan(grid.length * 0.85);
  });

  it('every body point follows something on a real conductor', async () => {
    for (const bodyPoint of ['impact', 'wrist', 'com'] as const) {
      const h = conductorNode.make(conductorNode.params.parse({ ...BODY, bodyPoint }));
      const outs = await replayNode(h, { body }, { dt: 1 / FPS });
      expect(outs[outs.length - 1].beat as number, bodyPoint).toBeGreaterThan(grid.length * 0.7);
    }
  });

  it('the source decides the input: hands are not read while reading the body, nor the body while reading the hands', async () => {
    const hands = loadStream('conducting_44', 'src.hands') as HandsFrame[];
    const n = Math.min(hands.length, body.length);
    const nobody = body.slice(0, n).map((f) => ({ ...f, present: false, landmarks: [], visibility: [] }));
    const bodyReader = conductorNode.make(conductorNode.params.parse(BODY));
    const a = await replayNode(bodyReader, { hands: hands.slice(0, n), body: nobody }, { dt: 1 / FPS });
    expect(a[a.length - 1].beat).toBe(0);
    const handReader = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
    const empty: HandsFrame[] = Array.from({ length: n }, () => ({ width: 1920, height: 1080, hands: [] }));
    const b = await replayNode(handReader, { hands: empty, body: body.slice(0, n) }, { dt: 1 / FPS });
    expect(b[b.length - 1].beat).toBe(0);
  });

  it('switching the source live, hands to body: the beat keeps its place, then the body leads', async () => {
    const h = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
    const hands = loadStream('conducting_44', 'src.hands') as HandsFrame[];
    const n = Math.min(hands.length, body.length);
    const half = Math.floor(n / 2);
    const config = body.slice(0, n).map((_, i) => (i < half ? { enabled: true, ...RECORDED } : BODY));
    const outs = await replayNode(h, { hands: hands.slice(0, n), body: body.slice(0, n), config }, { dt: 1 / FPS });
    const beats = outs.map((o) => o.beat as number);
    expect(monotone(beats)).toBe(true);
    expect(beats[half - 1]).toBeGreaterThan(3);
    expect((outs[half].time as { anchors: number }).anchors).toBe(0);
    expect(beats[half]).toBeCloseTo(beats[half - 1], 6);
    expect(beats[n - 1]).toBeGreaterThan(beats[half - 1] + 2);
  });

  it('a fermata held across a rebuild of the follower is released by its first stroke', async () => {
    const doc = { v: 1, title: 't', source: 'builtin', parts: [], tempoMap: [{ beat: 0, bpm: 87 }], timeSignatures: [], dynamics: [], fermatas: [6], lengthBeats: 64 };
    const run = async (switchAfterHold: boolean) => {
      const h = conductorNode.make(conductorNode.params.parse(BODY));
      let held = -1;
      let heldTicks = 0;
      for (let i = 0; i < body.length; i++) {
        const config = switchAfterHold && held >= 0 && i > held ? { ...BODY, hand: 'right' } : BODY;
        const o = (await h.process({ body: body[i], doc, config }, { time: i / FPS, dt: 1 / FPS, tick: i, resources: {} } as never)) as { time: { state: string }; beat: number };
        if (o.beat === 6 && o.time.state === 'hold') {
          if (held < 0) held = i;
          heldTicks += 1;
        }
      }
      return heldTicks;
    };
    const plain = await run(false);
    const rebuilt = await run(true);
    expect(plain).toBeGreaterThan(0);
    // One new stroke releases it: at most a little over a beat (87 bpm, 30 fps) longer.
    expect(rebuilt).toBeLessThan(plain + 2 * FPS);
  });

  it('switching the body point live keeps the beat where it is and waits for the next stroke', async () => {
    const h = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
    const n = 360;
    const config = body.slice(0, n).map((_, i) => (i < 180 ? BODY : { ...BODY, bodyPoint: 'com' }));
    const outs = await replayNode(h, { body: body.slice(0, n), config }, { dt: 1 / FPS });
    const beats = outs.map((o) => o.beat as number);
    expect(monotone(beats)).toBe(true);
    expect(beats[179]).toBeGreaterThan(4);
    // Re-created: the new follower has seen no stroke yet, so the beat holds right after.
    expect((outs[180].time as { anchors: number }).anchors).toBe(0);
    expect(beats[180]).toBeCloseTo(beats[179], 6);
    expect(beats[n - 1]).toBeGreaterThan(beats[179] + 1);
  });
});

/** The composed instrument graph for a conductor reading the body, the body replayed. */
function bodyConductorGraph(frames: BodyFrame[]): GraphSpec {
  const ids = branchIdsFor({ handMap: { maxGain: 0 }, conductor: { enabled: true, source: 'body' } });
  expect(ids).toContain('conductor');
  expect(ids).toContain('body-source');
  const { spec } = composeInstrumentGraph(ids, { body: 'replay-body', source: 'synthetic-hands' }, createAppRegistry());
  return { ...spec, nodes: spec.nodes.map((n) => (n.id === 'camBody' ? { ...n, params: { frames } } : n)) };
}

describe('the body conductor in the composed instrument graph (?slot.body=replay-body)', () => {
  it.runIf(BODY_SLICE)('the beat is monotone and the score sounds a note on most beats, reaching the merge', async () => {
    const ticks = body.length;
    const controls = { ...useControls.getState(), conductor: { ...useControls.getState().conductor, ...DEFAULT_CONDUCTOR_DIAL, ...BODY } };
    const { recorder } = await runHeadless(bodyConductorGraph(body), createAppRegistry(), {
      ticks,
      nominalDt: 1 / FPS,
      resources: { controls: () => controls },
      recordOnly: ['conductor.beat', 'score.params', 'merge.params'],
    });
    const beats = recorder.values('conductor.beat') as number[];
    const score = recorder.values('score.params') as SynthParams[];
    expect(monotone(beats)).toBe(true);
    const whole = Math.floor(beats[beats.length - 1]);
    expect(whole).toBeGreaterThan(grid.length * 0.85);
    // A beat "has its note" when the score sounds while the beat is inside it (each demo
    // note starts on a beat and lasts 0.9 of one).
    let withNote = 0;
    for (let k = 0; k < whole; k++) {
      if (beats.some((b, i) => b >= k && b < k + 0.9 && score[i].voices.some((v) => v.present))) withNote += 1;
    }
    expect(withNote / whole).toBeGreaterThan(0.85);
    const merged = recorder.values('merge.params') as SynthParams[];
    expect(merged.some((p) => p.voices.some((v) => v.present && v.id >= SCORE_VOICE_ID_BASE))).toBe(true);
  });
});

describe('structural guard: conductor.body is connected whenever the source is body', () => {
  const registry = createAppRegistry();
  const bodyEdge = (spec: GraphSpec) => spec.edges.some((e) => e.from.node === 'camBody' && e.from.port === 'body' && e.to.node === 'conductor' && e.to.port === 'body');
  const cases: Record<string, Parameters<typeof branchIdsFor>> = {
    'conducting with the body': [{ conductor: { enabled: true, source: 'body' } }],
    'the orchestra on, not yet started': [{ conductor: { enabled: false, source: 'body', orchestra: { enabled: true } } }],
    'leading a recording': [{ conductor: { enabled: true, source: 'body', conducts: 'recording' }, songHandle: {} }],
    'an explicit branch set': [{ conductor: { enabled: true, source: 'body' } }, { explicit: ['conductor'] }],
  };
  for (const [name, args] of Object.entries(cases)) {
    it.runIf(BODY_SLICE)(name, () => {
      const ids = branchIdsFor(...args);
      expect(ids).toContain('conductor');
      const { spec } = composeInstrumentGraph(ids, {}, registry);
      expect(bodyEdge(spec)).toBe(true);
    });
  }

  it('an explicit set that lists an idle conductor does not start the pose camera', () => {
    expect(branchIdsFor({ conductor: { enabled: false, source: 'body' } }, { explicit: ['conductor'] })).not.toContain('body-source');
  });

  it('the hand conductor does not start the pose camera', () => {
    expect(branchIdsFor({ conductor: { enabled: true, source: 'hands' } })).not.toContain('body-source');
    expect(branchIdsFor({ conductor: { enabled: true } })).not.toContain('body-source');
    expect(branchIdsFor({ conductor: { enabled: false, source: 'body' } })).not.toContain('body-source');
  });
});
