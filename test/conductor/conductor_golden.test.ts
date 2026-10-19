/**
 * The conductor node's differential golden (#470): the refactor of `process()` into named
 * steps must change nothing a caller can see. Each scenario drives the node over a recorded
 * or scripted input and hashes EVERY output of EVERY tick (sha256 of the full JSON, with
 * non-finite numbers and -0 spelled out); the hashes were recorded from the node before the
 * split and live in `test/fixtures/conductor_golden.json`. A hash that moves names the
 * scenario, and `CONDUCTOR_GOLDEN_DUMP=<dir>` writes each scenario's full output so two
 * runs can be diffed tick by tick.
 *
 * Scenarios cover each branch of `process()`: the hand conductor on the three recorded
 * patterns (priors, servo, levels, fermatas, recording lead, config toggling), the split
 * role with two hands, the body conductor on A1's fixtures and on scripted transport
 * gestures (rules, pose override, lead offsets, expression from the body), and the dancer
 * leading the score and the recording. `CONDUCTOR_GOLDEN_UPDATE=1` rewrites the file;
 * do that only when a behaviour change is intended.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { replayNode } from '@thoremin/dag';
import { type BodyFrame, type HandsFrame } from '@/nodes';
import { conductorNode } from '@/slices/conductor/nodes/conductor';
import { bodyPulseNode } from '@/slices/body/nodes/body_pulse';
import { conduct, type Gesture } from '../helpers/body_conduct';
import { loadStream } from '../helpers/fixtures';
import { CONDUCTOR } from '../helpers/extensions';

const GOLDEN = join(__dirname, '..', 'fixtures', 'conductor_golden.json');
const FPS = 30;
const RECORDED = { mirrorX: false, mirrorHandedness: false };

const doc = (over: Record<string, unknown> = {}) => ({
  v: 1,
  title: 'golden',
  source: 'builtin',
  parts: [],
  tempoMap: [{ beat: 0, bpm: 70 }],
  timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
  dynamics: [],
  fermatas: [],
  lengthBeats: 64,
  ...over,
});
const DOC_FERMATA = doc({ fermatas: [8, 24], tempoMap: [{ beat: 0, bpm: 70 }, { beat: 16, bpm: 90 }] });
const DOC_34 = doc({ timeSignatures: [{ beat: 0, numerator: 3, denominator: 4 }], tempoMap: [{ beat: 0, bpm: 70 }], lengthBeats: 48 });
const DOC_128 = doc({ tempoMap: [{ beat: 0, bpm: 128 }], fermatas: [32], lengthBeats: 1024 });

const fill = <T,>(n: number, v: T): T[] => Array.from({ length: n }, () => v);
const handsOf = (clip: string) => loadStream(clip, 'src.hands') as HandsFrame[];
const bodyOf = (clip: string) => loadStream(clip, 'camBody.body') as BodyFrame[];

type Scenario = { params: Record<string, unknown>; inputs: Record<string, unknown[]> };

const scenarios: Record<string, () => Promise<Scenario> | Scenario> = {};
const add = (name: string, make: () => Promise<Scenario> | Scenario) => (scenarios[name] = make);

// ---- the hand conductor ----
for (const clip of ['conducting_44', 'conducting_34', 'conducting_24']) {
  const hands = handsOf(clip);
  const n = hands.length;
  add(`hands/${clip}/default`, () => ({ params: { enabled: true, ...RECORDED }, inputs: { hands } }));
  add(`hands/${clip}/doc-fermata`, () => ({ params: { enabled: true, ...RECORDED }, inputs: { hands, doc: fill(n, DOC_FERMATA) } }));
}
{
  const hands = handsOf('conducting_44');
  const n = hands.length;
  for (const prior of ['oscillator', 'trend', 'blend']) add(`hands/44/prior-${prior}`, () => ({ params: { enabled: true, prior, ...RECORDED }, inputs: { hands } }));
  add('hands/44/servo-3-point-index', () => ({ params: { enabled: true, servoBeats: 3, point: 'indexTip', ...RECORDED }, inputs: { hands } }));
  add('hands/44/mark-half', () => ({ params: { enabled: true, markLevel: 'half', ...RECORDED }, inputs: { hands, doc: fill(n, DOC_34) } }));
  add('hands/44/mark-bar', () => ({ params: { enabled: true, markLevel: 'bar', ...RECORDED }, inputs: { hands, doc: fill(n, DOC_FERMATA) } }));
  add('hands/44/mark-auto', () => ({ params: { enabled: true, markLevel: 'auto', ...RECORDED }, inputs: { hands, doc: fill(n, DOC_FERMATA) } }));
  add('hands/44/recording', () => ({ params: { enabled: true, conducts: 'recording', ...RECORDED }, inputs: { hands } }));
  add('hands/44/left-hand', () => ({ params: { enabled: true, hand: 'left', ...RECORDED }, inputs: { hands } }));
  add('hands/44/disabled', () => ({ params: { enabled: false, ...RECORDED }, inputs: { hands } }));
  // The dial toggles live: off, on, off, on again (the core is re-created on the switch).
  add('hands/44/config-toggle', () => ({
    params: { enabled: true, ...RECORDED },
    inputs: { hands, doc: fill(n, DOC_FERMATA), config: hands.map((_, i) => ({ enabled: Math.floor(i / 90) % 2 === 0, servoBeats: i < 200 ? 1 : 2 })) },
  }));
  add('hands/44/no-hand-then-hand', () => ({ params: { enabled: true, ...RECORDED }, inputs: { hands: hands.map((f, i) => (i < 60 ? { ...f, hands: [] } : f)) } }));
}
{
  // A second hand (the other label) wobbling above the beating one, so the shaping hand has
  // something to read: the recorded pattern with a synthetic partner.
  const base = handsOf('conducting_44');
  const two = base.map((f, i) => ({
    ...f,
    hands: [
      ...f.hands,
      ...f.hands.slice(0, 1).map((h) => ({
        ...h,
        handedness: (h.handedness === 'Right' ? 'Left' : 'Right') as typeof h.handedness,
        worldKeypoints: undefined,
        keypoints: h.keypoints.map((k) => ({ ...k, x: f.width - k.x, y: k.y - 0.2 * f.height * (0.5 + 0.5 * Math.sin(i / 25)) })),
      })),
    ],
  }));
  add('hands/two/split-left-shapes', () => ({ params: { enabled: true, expression: 'hands', expressionHand: 'left', ...RECORDED }, inputs: { hands: two } }));
  add('hands/two/split-right-shapes', () => ({ params: { enabled: true, hand: 'left', expression: 'hands', expressionHand: 'right', ...RECORDED }, inputs: { hands: two } }));
}

// ---- the body conductor ----
for (const clip of ['video_body_conducting_44', 'video_body_conducting_34', 'video_body_conducting_24']) {
  const body = bodyOf(clip);
  const n = body.length;
  add(`body/${clip}/default`, () => ({ params: { enabled: true, source: 'body', ...RECORDED }, inputs: { body } }));
  add(`body/${clip}/auto-fermata`, () => ({ params: { enabled: true, source: 'body', markLevel: 'auto', ...RECORDED }, inputs: { body, doc: fill(n, DOC_FERMATA) } }));
}
{
  const body = bodyOf('video_body_conducting_44');
  const n = body.length;
  for (const bodyPoint of ['wrist', 'head', 'hips', 'com']) add(`body/44/point-${bodyPoint}`, () => ({ params: { enabled: true, source: 'body', bodyPoint, ...RECORDED }, inputs: { body } }));
  add('body/44/expression-body-flow', () => ({ params: { enabled: true, source: 'body', expression: 'body', articulationFrom: 'flow', ...RECORDED }, inputs: { body, doc: fill(n, DOC_FERMATA) } }));
  add('body/44/transport-rules-off', () => ({ params: { enabled: true, source: 'body', transport: { rules: false }, ...RECORDED }, inputs: { body } }));
  add('body/44/lead-offsets', () => ({ params: { enabled: true, source: 'body', ...RECORDED }, inputs: { body, leadOffsets: fill(n, { wrist: 0.06, trunk: 0.03 }) } }));
  add('body/44/hands-expression', () => ({ params: { enabled: true, source: 'body', expression: 'hands', ...RECORDED }, inputs: { body, hands: handsOf('conducting_44').slice(0, n), doc: fill(n, DOC_FERMATA) } }));
  add('body/44/recording', () => ({ params: { enabled: true, source: 'body', conducts: 'recording', ...RECORDED }, inputs: { body } }));
}
{
  const gestures: Gesture[] = [
    { kind: 'rest', s: 1 },
    { kind: 'ready', s: 1 },
    { kind: 'upbeat', s: 0.9 },
    { kind: 'beat', bpm: 80, beats: 8, size: 1 },
    { kind: 'beat', bpm: 80, beats: 4, size: 1.8, shape: 'smooth' },
    { kind: 'hold', s: 3 },
    { kind: 'beat', bpm: 80, beats: 4 },
    { kind: 'cutoff', s: 1.5 },
    { kind: 'rest', s: 1 },
    { kind: 'ready', s: 1 },
    { kind: 'upbeat', s: 0.9 },
    { kind: 'beat', bpm: 100, beats: 8 },
    { kind: 'fidget', s: 1.5 },
    { kind: 'absent', s: 2.5 },
  ];
  const { frames } = conduct(gestures, { arm: 'jointed' });
  const n = frames.length;
  const SRC = { enabled: true, source: 'body', ...RECORDED };
  add('script/rules', () => ({ params: SRC, inputs: { body: frames, doc: fill(n, DOC_FERMATA) } }));
  add('script/rules-no-doc', () => ({ params: SRC, inputs: { body: frames } }));
  add('script/pose-override', () => ({
    params: SRC,
    inputs: {
      body: frames,
      doc: fill(n, DOC_FERMATA),
      // Only the roles a pose states: a role it leaves out stays the rule's.
      transportPose: frames.map((_, i) => ({ ...(i >= 30 && i < 60 ? { ready: true } : {}), ...(i >= 360 && i < 440 ? { hold: true } : {}), ...(i >= 540 && i < 560 ? { cutoff: true } : {}) })),
    },
  }));
  add('script/elbow-wrist-levels', () => ({ params: { ...SRC, bodyPoint: 'wrist', markLevel: 'half', expression: 'same' }, inputs: { body: frames, doc: fill(n, DOC_34) } }));
  add('script/right-arm-hands-shape', () => ({ params: { ...SRC, hand: 'right', expression: 'hands', expressionHand: 'left' }, inputs: { body: frames, hands: fill(n, undefined) } }));
}

// ---- the dancer ----
{
  const clip = bodyOf('video_body_que_calor').slice(0, 20 * FPS);
  const n = clip.length;
  const pulses = async () => (await replayNode(bodyPulseNode.make(bodyPulseNode.params.parse({})), { body: clip }, { dt: 1 / FPS })).map((o) => o.pulse);
  add('dancer/score', async () => ({ params: { enabled: true, source: 'dancer' }, inputs: { pulse: await pulses(), body: clip, doc: fill(n, DOC_128) } }));
  add('dancer/no-doc', async () => ({ params: { enabled: true, source: 'dancer' }, inputs: { pulse: await pulses() } }));
  add('dancer/recording', async () => ({ params: { enabled: true, source: 'dancer', conducts: 'recording' }, inputs: { pulse: await pulses(), body: clip } }));
  add('dancer/switch-away-and-back', async () => ({
    params: { enabled: true, source: 'dancer' },
    inputs: { pulse: await pulses(), body: clip, doc: fill(n, DOC_128), config: clip.map((_, i) => ({ enabled: true, source: i > 200 && i < 330 ? 'hands' : 'dancer' })) },
  }));
}

const replacer = (_k: string, v: unknown) => {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '-Infinity';
    if (Object.is(v, -0)) return '-0';
  }
  if (v === undefined) return '__undefined__';
  return v;
};

/** What one scenario produced: the hash of everything, and a few figures that show it is not
 *  an empty run. */
async function summarise(s: Scenario, name: string) {
  const handler = conductorNode.make(conductorNode.params.parse(s.params));
  const outs = await replayNode(handler, s.inputs, { dt: 1 / FPS });
  const json = JSON.stringify(outs, replacer);
  const dump = process.env.CONDUCTOR_GOLDEN_DUMP;
  if (dump) {
    mkdirSync(join(dump, name.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(join(dump, `${name}.json`), JSON.stringify(outs, replacer, 1));
  }
  const states = outs.map((o) => (o.time as { state?: string } | undefined)?.state);
  return {
    hash: createHash('sha256').update(json).digest('hex'),
    ticks: outs.length,
    running: states.filter((x) => x === 'running').length,
    holds: states.filter((x) => x === 'hold').length,
    endBeat: Number(((outs.at(-1)?.beat as number | undefined) ?? 0).toFixed(3)),
  };
}

describe.runIf(CONDUCTOR)('the conductor node: outputs byte-identical to the recorded golden (#470)', () => {
  const update = process.env.CONDUCTOR_GOLDEN_UPDATE === '1';
  const golden: Record<string, ReturnType<typeof Object>> = update ? {} : JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const produced: Record<string, Awaited<ReturnType<typeof summarise>>> = {};

  for (const [name, make] of Object.entries(scenarios)) {
    it(name, async () => {
      const got = await summarise(await make(), name);
      produced[name] = got;
      if (update) return;
      expect(golden[name], `no golden for ${name}`).toBeDefined();
      expect(got).toEqual(golden[name]);
    });
  }

  it('covers every golden entry and no scenario is an empty run', () => {
    if (update) {
      writeFileSync(GOLDEN, JSON.stringify(produced, null, 1) + '\n');
      return;
    }
    expect(Object.keys(golden).sort()).toEqual(Object.keys(scenarios).sort());
    // The scenarios that must have run the follower, not sat idle.
    for (const name of Object.keys(scenarios)) {
      if (/disabled|no-hand|rules-off/.test(name)) continue;
      expect(golden[name].ticks, name).toBeGreaterThan(100);
    }
    const running = Object.values(golden).filter((g) => (g as { running: number }).running > 0).length;
    expect(running).toBeGreaterThan(Object.keys(golden).length * 0.7);
  });
});
