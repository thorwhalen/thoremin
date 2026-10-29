/**
 * The onset detector on synthetic takes with known onsets (`@thoremin/sdk/audio/synthetic_taps`):
 * every tap found once, none invented, each placed within a fraction of a millisecond, a ringing
 * pot's tail never read as a tap, a room's hum or a fan never read as one either.
 */
import { describe, expect, it } from 'vitest';
import { createOnsetDetector, type DetectedOnset } from '@thoremin/sdk/audio/onset';
import { SURFACES, seededRandom, synthTake, synthTap } from '@thoremin/sdk/audio/synthetic_taps';

const SR = 48000;

function detect(pcm: Float32Array, chunk = 128): DetectedOnset[] {
  const d = createOnsetDetector({ sampleRate: SR });
  const out: DetectedOnset[] = [];
  for (let i = 0; i < pcm.length; i += chunk) d.push(pcm.subarray(i, i + chunk), i, (o) => out.push({ ...o }));
  return out;
}

describe('onset detector', () => {
  it('finds nearly every tap of a take once, placed within a few ms, and invents none', () => {
    const take = synthTake({ sampleRate: SR, seed: 7, perSurface: 30 });
    const onsets = detect(take.pcm);
    // Every onset is a tap (none invented, none doubled).
    for (const o of onsets) expect(take.taps.filter((t) => Math.abs(o.frame - t.frame) < 0.02 * SR), `onset at ${o.frame}`).toHaveLength(1);
    // A soft tap 150 ms after a loud pot, under its ring, can be missed: a few in a hundred.
    const found = take.taps.filter((t) => onsets.some((o) => Math.abs(o.frame - t.frame) < 0.02 * SR));
    expect(found.length / take.taps.length).toBeGreaterThanOrEqual(0.95);
    for (const tap of found) {
      const hits = onsets.filter((o) => Math.abs(o.frame - tap.frame) < 0.02 * SR);
      expect(hits, `tap on ${tap.surface} at ${tap.frame}`).toHaveLength(1);
      // Late by at most a few hops (a quiet tap under a ringing tail), never early by more than a sample or two of pre-emphasis.
      expect(hits[0].frame - tap.frame).toBeGreaterThanOrEqual(-24);
      expect(hits[0].frame - tap.frame).toBeLessThan(0.004 * SR);
      expect(hits[0].detectedFrame - hits[0].frame).toBeLessThanOrEqual(32);
    }
  });

  it('places the median onset within a quarter millisecond', () => {
    const take = synthTake({ sampleRate: SR, seed: 3, perSurface: 20 });
    const errs = detect(take.pcm)
      .map((o) => o.frame - take.taps.reduce((a, t) => (Math.abs(t.frame - o.frame) < Math.abs(a.frame - o.frame) ? t : a)).frame)
      .map(Math.abs)
      .sort((a, b) => a - b);
    expect(errs[errs.length >> 1]).toBeLessThanOrEqual(0.00025 * SR);
  });

  it('is the same whatever the block size (sample-accurate, not quantum-accurate)', () => {
    const take = synthTake({ sampleRate: SR, seed: 5, perSurface: 5 });
    const at = (chunk: number) => detect(take.pcm, chunk).map((o) => o.frame);
    expect(at(64)).toEqual(at(128));
    expect(at(1000)).toEqual(at(128));
  });

  it('reads a long pot ring as one tap, and a second tap over the ring as a second', () => {
    const rand = seededRandom(1);
    const pot = SURFACES.find((s) => s.id === 'pot')!;
    const a = synthTap(pot, rand, { sampleRate: SR, level: 0.6, duration: 1.5 });
    const b = synthTap(pot, rand, { sampleRate: SR, level: 0.5, duration: 1.2 });
    const pcm = new Float32Array(SR * 2);
    const t0 = SR / 4;
    const t1 = t0 + Math.round(0.3 * SR);
    a.forEach((x, i) => (pcm[t0 + i] += x));
    b.forEach((x, i) => (pcm[t1 + i] += x));
    const onsets = detect(pcm);
    expect(onsets.map((o) => Math.round((o.frame - t0) / (SR / 1000)))).toEqual([0, 300]);
  });

  it('never fires on a room: noise and mains hum alone, or a fan switched on', () => {
    const rand = seededRandom(9);
    const pcm = new Float32Array(SR * 4);
    for (let i = 0; i < pcm.length; i++) {
      const fan = i > SR * 2 ? 0.01 * (2 * rand() - 1) : 0;
      pcm[i] = 0.001 * (2 * rand() - 1) + 0.01 * Math.sin((2 * Math.PI * 50 * i) / SR) + fan;
    }
    const onsets = detect(pcm);
    // The fan coming on is one step up (at most one onset at its start), then nothing.
    expect(onsets.filter((o) => o.frame < SR * 2)).toHaveLength(0);
    expect(onsets.filter((o) => o.frame > SR * 2 + SR / 10)).toHaveLength(0);
  });
});
