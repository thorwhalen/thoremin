/**
 * Three small things the conductor and the body carve say to the player, each with untested
 * branches: the conductor's beat ring on the video (`conductorHudElement`: hidden when its show
 * flag is off or the follower is off, the phase arc and the on-beat flash while running, the
 * beat-in-bar count, and the words when it is not running), the body pose features in plain
 * words (`bodyWords`), and the score loader's browser fetch (`fetchBytesFromUrl`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyWords } from '@thoremin/sdk/features/modalities/body_words';
import { conductorHudElement } from '@/slices/conductor/nodes/overlay/conductor_hud';
import { fetchBytesFromUrl } from '@/slices/conductor/app/resolvePiece';
import { CONDUCTOR } from '../helpers/extensions';

/** A 2D context that records its calls and the state each `fillText` was drawn in. */
function recordingContext() {
  const calls: [string, ...unknown[]][] = [];
  const state: Record<string, unknown> = {};
  const g = new Proxy(state, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return (...args: unknown[]) => void calls.push([prop, ...args]);
    },
    set(t, prop: string, value) {
      t[prop] = value;
      calls.push([`set:${prop}`, value]);
      return true;
    },
  });
  const texts = () => calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  return { g: g as unknown as CanvasRenderingContext2D, calls, texts };
}

const time = (t: Record<string, unknown>) => ({ t: 0, beat: 0, phase: 0, tempo: 0, period: 0, confidence: 0, beatsPerBar: 4, state: 'waiting', anchors: 0, ...t });
const draw = (inputs: Record<string, unknown>) => {
  const r = recordingContext();
  conductorHudElement.draw(r.g, { W: 640, H: 480 } as never, { enabled: true, ...inputs } as never, {});
  return r;
};

describe.runIf(CONDUCTOR)('the conductor beat ring on the video', () => {
  it('draws nothing when its show flag is off, the follower is off, or there is no time yet', () => {
    expect(draw({ config: { hudOnVideo: { show: false } }, time: time({}) }).calls).toEqual([]);
    expect(draw({ enabled: false, time: time({}) }).calls).toEqual([]);
    expect(draw({}).calls).toEqual([]);
  });

  it('while running: the phase arc, the beat in the bar and the tempo', () => {
    const { calls, texts } = draw({ time: time({ state: 'running', tempo: 92.4, beat: 6.5, phase: 0.5 }) });
    // The phase arc runs from the top half way round.
    expect(calls).toContainEqual(['arc', 320, 44, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI]);
    expect(texts()).toEqual(['3', '92 bpm · 3/4']);
    // No flash half way through the beat.
    expect(calls.some((c) => c[0] === 'fill')).toBe(false);
  });

  it('flashes on the beat, fading through the first tenth of it', () => {
    const { calls } = draw({ time: time({ state: 'running', tempo: 60, beat: 4.02, phase: 0.02 }) });
    expect(calls).toContainEqual(['set:globalAlpha', expect.closeTo(0.8, 9)]);
    expect(calls.filter((c) => c[0] === 'fill')).toHaveLength(1);
  });

  it('clamps a phase outside 0..1, and counts a negative beat into the bar', () => {
    const { calls, texts } = draw({ time: time({ state: 'running', tempo: 60, beat: -1, phase: 1.5 }) });
    expect(calls).toContainEqual(['arc', 320, 44, 18, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI]);
    expect(texts()[0]).toBe('4');
  });

  it.each([
    [{ state: 'waiting', anchors: 0 }, '…', 'waiting for your first beat'],
    [{ state: 'hold', anchors: 5 }, '||', 'holding'],
    [{ state: 'waiting', anchors: 3 }, '…', 'finding your tempo'],
    [{ state: 'running', tempo: 0, anchors: 3 }, '…', 'finding your tempo'],
  ])('when not running (%o) it says so in words', (t, mark, words) => {
    const { calls, texts } = draw({ time: time(t) });
    expect(texts()).toEqual([mark, words]);
    // The empty ring only.
    expect(calls.filter((c) => c[0] === 'arc')).toHaveLength(1);
  });
});

describe('the body pose features in plain words', () => {
  it.each([
    ['body.dir.upperArm.left.up', { name: 'left upper arm raised', movement: 'left-arm-raise' }],
    ['body.dir.forearm.right.up', { name: 'right forearm raised' }],
    ['body.dir.thigh.left.out', { name: 'left thigh out to the side', less: 'bring your left thigh in toward your body' }],
    ['body.dir.shank.right.fwd', { name: 'right lower leg forward', more: 'bring your right lower leg further forward' }],
    ['body.dir.foot.left.up', { name: 'left foot raised' }],
    ['body.angle.torso.lean', { name: 'torso lean', signed: true }],
    ['body.angle.head.tilt', { name: 'head tilt', signed: true }],
    ['body.angle.elbow.left', { name: 'left elbow bend', invert: true }],
    ['body.angle.knee.right', { name: 'right knee bend', invert: true }],
    ['body.angle.hip.left', { name: 'left hip bend', invert: true }],
    ['body.angle.shoulder.right', { name: 'right arm raised', movement: 'right-arm-raise' }],
    ['body.pos.wrist.left.rise', { name: 'left hand height' }],
    ['body.shape.extension', { name: 'reach' }],
    ['body.shape.height', { name: 'crouch', invert: true }],
  ])('%s', (id, words) => {
    expect(bodyWords(id)).toMatchObject(words);
  });

  it.each([
    'face.mouth.open',
    'body.dir.forearm.left.sideways',
    'body.dir.forearm.left',
    'body.angle.elbow',
    'body.angle.torso',
    'body.angle.wrist.left',
    'body.angle',
    'body.pos.wrist.left.speed',
    'body.pos.ankle.left.rise',
    'body.shape.toString',
    'body.shape.unknown',
    'body.motion.wrist.left',
  ])('%s is not named', (id) => {
    expect(bodyWords(id)).toBeUndefined();
  });

  it('only the upper arm carries the arm-raise movement', () => {
    expect(bodyWords('body.dir.forearm.left.up')).not.toHaveProperty('movement');
  });
});

describe.runIf(CONDUCTOR)('fetchBytesFromUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the body as bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })));
    expect([...(await fetchBytesFromUrl('/scores/a.mid'))]).toEqual([1, 2, 3]);
  });

  it('a failed response rejects, naming the url and the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(fetchBytesFromUrl('/scores/gone.mid')).rejects.toThrow('Could not fetch /scores/gone.mid (404)');
  });
});
