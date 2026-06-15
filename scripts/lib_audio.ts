/**
 * Offline synth DSP library (no side effects) — turn a `SynthParams` stream into
 * PCM and write a 16-bit WAV. Imported by `render_audio.ts` (the CLI) and by
 * `test/render_audio.test.ts`. Pure: importing this never runs anything.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SynthParams, VoiceParams } from '@/nodes';

export const SR = 44100;
const MASTER = 0.25;

function wave(phase: number, type: VoiceParams['instrument']): number {
  const p = phase - Math.floor(phase); // 0..1
  switch (type) {
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'sawtooth':
      return 2 * p - 1;
    case 'triangle':
      return 4 * Math.abs(p - 0.5) - 1;
    default:
      return Math.sin(2 * Math.PI * p);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface VoiceState {
  phase: number;
  gain: number;
  freq: number;
}

/** Render a per-tick SynthParams stream to mono PCM (sum of oscillator voices). */
export function render(frames: SynthParams[], dt: number): Float32Array {
  const samplesPerTick = Math.max(1, Math.round(SR * dt));
  const out = new Float32Array(frames.length * samplesPerTick);
  const voices = new Map<number, VoiceState>();

  let s = 0;
  for (const frame of frames) {
    const targets = new Map<number, VoiceParams>();
    for (const v of frame.voices) targets.set(v.id, v);

    for (let j = 0; j < samplesPerTick; j++) {
      const frac = j / samplesPerTick;
      let acc = 0;
      for (const [id, target] of targets) {
        let st = voices.get(id);
        if (!st) {
          st = { phase: 0, gain: 0, freq: target.freq };
          voices.set(id, st);
        }
        const curGain = target.present ? target.gain : 0;
        const g = lerp(st.gain, curGain, frac); // ramp within tick (declick)
        const f = lerp(st.freq, target.freq, frac);
        st.phase += f / SR;
        acc += wave(st.phase, target.instrument) * g;
      }
      out[s++] = Math.max(-1, Math.min(1, acc * MASTER));
    }
    for (const [id, target] of targets) {
      const st = voices.get(id)!;
      st.gain = target.present ? target.gain : 0;
      st.freq = target.freq;
    }
  }
  return out;
}

export function rms(s: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / s.length);
}

export function writeWav(path: string, samples: Float32Array): void {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}
