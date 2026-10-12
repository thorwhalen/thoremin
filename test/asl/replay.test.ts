/**
 * Fixture replay of the whole recogniser (`test/fixtures/asl/clips.json`: real MediaPipe hand
 * landmarks of real signers, at their real timestamps, from the public Aslense corpus). These
 * clips are in the shipped models' training data, so this pins BEHAVIOUR end to end (the
 * fusion, smoothing, hysteresis and latch over real streams), not accuracy; the accuracy
 * numbers come from held-out data, in `docs/research/asl-recognition.md`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSignRecognizer, parseMlpModel, type HandInput, type SignId } from '@thoremin/asl';
import staticJson from '@thoremin/asl/models/static.json';
import motionJson from '@thoremin/asl/models/motion.json';

interface Clip {
  gloss: string;
  width: number;
  height: number;
  frames: { t: number; hands: HandInput[] }[];
}
const { clips } = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'asl', 'clips.json'), 'utf8')) as { clips: Clip[] };
const staticModel = parseMlpModel(staticJson);
const motionModel = parseMlpModel(motionJson);

/** Replay a clip; return every sign named, in order, deduplicated. */
function named(clip: Clip): SignId[] {
  const r = createSignRecognizer(staticModel, motionModel);
  const out: SignId[] = [];
  for (const f of clip.frames) {
    const s = r.update({ width: clip.width, height: clip.height, hands: f.hands }, f.t);
    if (s.label && out[out.length - 1] !== s.label) out.push(s.label);
    if (s.present) expect(s.scores.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
  }
  return out;
}

const expected: Record<string, SignId> = { b: 'B', l: 'L', y: 'Y', yes: 'yes', please: 'please', thankyou: 'thankyou' };

describe('replaying real signers through the recogniser', () => {
  for (const clip of clips) {
    it(`"${clip.gloss}" is named`, () => {
      expect(named(clip)).toContain(expected[clip.gloss]);
    });
  }

  it('a held letter is the sign named nearly all the time a hand is in view', () => {
    const clip = clips.find((c) => c.gloss === 'b')!;
    const r = createSignRecognizer(staticModel, motionModel);
    const read = clip.frames.map((f) => r.update({ width: clip.width, height: clip.height, hands: f.hands }, f.t)).filter((s) => s.present);
    expect(read.filter((s) => s.label === 'B').length / read.length).toBeGreaterThan(0.8);
  });

  it('a one-frame tracking blink keeps the reading; a real absence clears it', () => {
    const clip = clips.find((c) => c.gloss === 'b')!;
    const r = createSignRecognizer(staticModel, motionModel);
    const read = (f: { t: number; hands: HandInput[] }) => r.update({ width: clip.width, height: clip.height, hands: f.hands }, f.t);
    const withHand = clip.frames.filter((f) => f.hands.length);
    for (const f of withHand.slice(0, 8)) read(f);
    const t = withHand[7]!.t;
    expect(read({ t: t + 0.05, hands: [] }).label).toBe('B'); // a blink
    expect(read({ t: t + 1, hands: [] }).present).toBe(false); // gone
  });

  it('the same camera frame ticked twice is read once', () => {
    const clip = clips.find((c) => c.gloss === 'b')!;
    const r = createSignRecognizer(staticModel, motionModel);
    const f = clip.frames.find((x) => x.hands.length)!;
    const a = r.update({ width: clip.width, height: clip.height, hands: f.hands }, f.t);
    expect(r.update({ width: clip.width, height: clip.height, hands: [] }, f.t)).toBe(a);
  });

  it('no hand: nothing is named and the scores are zero', () => {
    const r = createSignRecognizer(staticModel, motionModel);
    const s = r.update({ width: 640, height: 480, hands: [] }, 0);
    expect(s.present).toBe(false);
    expect(s.label).toBeNull();
    expect(s.scores.every((v) => v === 0)).toBe(true);
  });
});
