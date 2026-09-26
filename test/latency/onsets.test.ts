import { describe, expect, it } from 'vitest';
import { pairStrikes, strikeOnsets, toneAmplitude, toneOnsets } from '@/latency/onsets';

const SR = 48000;

/** Deterministic noise so the test never flakes. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

/** A slap: a broadband burst with an exponential tail (and a reverberant one). */
function addSlap(buf: Float32Array, atMs: number, rand: () => number): void {
  const start = Math.round((atMs / 1000) * SR);
  const len = Math.round(0.12 * SR);
  for (let i = 0; i < len && start + i < buf.length; i++) buf[start + i] += 0.8 * rand() * Math.exp(-i / (0.02 * SR));
}

function addTone(buf: Float32Array, atMs: number, hz = 3000, durMs = 20, amp = 0.3): void {
  const start = Math.round((atMs / 1000) * SR);
  const len = Math.round((durMs / 1000) * SR);
  for (let i = 0; i < len && start + i < buf.length; i++) buf[start + i] += amp * Math.sin((2 * Math.PI * hz * i) / SR);
}

describe('strike-test onset analysis', () => {
  it('reads a tone amplitude and ignores off-band energy', () => {
    const b = new Float32Array(960);
    addTone(b, 0, 3000, 20, 0.5);
    expect(toneAmplitude(b, SR, 0, 960, 3000)).toBeCloseTo(0.5, 1);
    expect(toneAmplitude(b, SR, 0, 960, 500)).toBeLessThan(0.05);
  });

  it('recovers strike-to-answer latencies to within a millisecond, through slap tails', () => {
    const rand = rng(7);
    const buf = new Float32Array(SR * 4);
    for (let i = 0; i < buf.length; i++) buf[i] = 0.002 * rand(); // room noise
    const truth = [
      { strike: 300, latency: 95 },
      { strike: 1100, latency: 128 },
      { strike: 1900, latency: 71 },
      { strike: 2800, latency: 110 },
    ];
    for (const { strike, latency } of truth) {
      addSlap(buf, strike, rand);
      addTone(buf, strike + latency);
    }
    const strikes = strikeOnsets(buf, SR);
    const answers = toneOnsets(buf, SR);
    expect(answers).toHaveLength(truth.length);
    const pairs = pairStrikes(strikes, answers);
    expect(pairs).toHaveLength(truth.length);
    pairs.forEach((p, i) => {
      expect(Math.abs(p.strikeMs - truth[i].strike)).toBeLessThan(1);
      expect(Math.abs(p.latencyMs - truth[i].latency)).toBeLessThan(1);
    });
  });

  it('leaves a missed strike and a false answer unpaired', () => {
    const pairs = pairStrikes([100, 1000], [1105, 3000]);
    expect(pairs).toEqual([{ strikeMs: 1000, answerMs: 1105, latencyMs: 105 }]);
  });
});
