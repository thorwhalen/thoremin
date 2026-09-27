/**
 * A plucked-string strum for onset tests (#247): six strings of a chord, each a harmonic
 * series whose upper partials die faster than the fundamental (the brightness of a
 * pluck is its attack), strummed across `spreadMs`, ringing with time constant `tauS`.
 * Re-strummed while the last strum still rings, which is how a guitar is played and is
 * exactly the case a level-rise detector misses.
 */
export interface StrumOptions {
  sampleRate: number;
  /** Strum times, seconds. */
  times: readonly number[];
  /** Fundamentals of the strings, Hz (default: an open G major chord). */
  strings?: readonly number[];
  tauS?: number;
  spreadMs?: number;
  harmonics?: number;
  amp?: number;
  durationS: number;
}

export const G_MAJOR_OPEN: readonly number[] = [98.0, 123.47, 146.83, 196.0, 246.94, 392.0];

export function strum(o: StrumOptions): Float32Array {
  const { sampleRate: sr, times, strings = G_MAJOR_OPEN, tauS = 1.5, spreadMs = 8, harmonics = 10, amp = 0.05, durationS } = o;
  const pcm = new Float32Array(Math.ceil(durationS * sr));
  times.forEach((t0, n) => {
    strings.forEach((f0, s) => {
      const start = t0 + (s * spreadMs) / 1000 / Math.max(1, strings.length - 1);
      const phase = (n * 7 + s * 3) % 11;
      for (let k = 1; k <= harmonics; k++) {
        const f = f0 * k;
        if (f > sr / 2) break;
        const tau = tauS / (1 + 0.8 * (k - 1));
        const a = amp / k;
        const end = Math.min(pcm.length, Math.round((start + 6 * tau) * sr));
        for (let i = Math.round(start * sr); i < end; i++) {
          const dt = i / sr - start;
          pcm[i] += a * Math.exp(-dt / tau) * Math.sin(2 * Math.PI * f * dt + phase);
        }
      }
    });
  });
  return pcm;
}
