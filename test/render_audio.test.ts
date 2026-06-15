/**
 * Tests the offline synth renderer's DSP: a SynthParams stream produces audible
 * (non-silent), correctly-sized PCM, and silence in → silence out.
 */
import { describe, it, expect } from 'vitest';
import { render } from '../scripts/lib_audio';
import type { SynthParams } from '@/nodes';

const SR = 44100;
const voice = (freq: number, gain: number): SynthParams => ({
  voices: [{ id: 0, present: true, freq, gain, instrument: 'sine' }],
});

function rms(s: Float32Array): number {
  let sum = 0;
  for (const x of s) sum += x * x;
  return Math.sqrt(sum / s.length);
}

describe('render_audio', () => {
  it('produces non-silent PCM of the right length for a held tone', () => {
    const dt = 0.1; // 100ms/frame
    const frames = Array.from({ length: 10 }, () => voice(440, 0.5));
    const out = render(frames, dt);
    expect(out.length).toBe(10 * Math.round(SR * dt)); // 1.0s
    expect(rms(out)).toBeGreaterThan(0.05);
    expect(Math.max(...out)).toBeLessThanOrEqual(1);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(-1);
  });

  it('silent (gain 0 / absent) → near-silence', () => {
    const frames: SynthParams[] = [
      { voices: [{ id: 0, present: false, freq: 440, gain: 0, instrument: 'sine' }] },
      { voices: [{ id: 0, present: false, freq: 440, gain: 0, instrument: 'sine' }] },
    ];
    const out = render(frames, 0.05);
    expect(rms(out)).toBeLessThan(0.01);
  });

  it('a chord (multiple voices) is louder than a single voice', () => {
    const single = render([voice(220, 0.4), voice(220, 0.4)], 0.1);
    const chord: SynthParams = {
      voices: [0, 1, 2].map((id) => ({ id, present: true, freq: 220 * (id + 1), gain: 0.4, instrument: 'sine' as const })),
    };
    const multi = render([chord, chord], 0.1);
    expect(rms(multi)).toBeGreaterThan(rms(single));
  });
});
