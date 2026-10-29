/**
 * A small in-place radix-2 FFT for the audio thread (the attack features of `./features.ts`).
 *
 * Written here rather than imported because the worklet bundle must stay small and
 * allocation-free: a plan is made once ({@link createFft}) with its twiddles and bit-reversal
 * table, and every transform after that writes into the caller's arrays. Sizes are powers of
 * two (the attack window is zero-padded up to one).
 */

export interface Fft {
  readonly size: number;
  /** Transform `re`/`im` in place (length `size`). */
  transform(re: Float64Array, im: Float64Array): void;
}

export function createFft(size: number): Fft {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two >= 2, got ${size}`);
  const levels = Math.log2(size);
  const rev = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sin[i] = -Math.sin((2 * Math.PI * i) / size);
  }
  return {
    size,
    transform(re, im) {
      for (let i = 0; i < size; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i];
          re[i] = re[j];
          re[j] = t;
          t = im[i];
          im[i] = im[j];
          im[j] = t;
        }
      }
      for (let half = 1; half < size; half <<= 1) {
        const step = size / (half * 2);
        for (let start = 0; start < size; start += half * 2) {
          for (let k = 0; k < half; k++) {
            const wr = cos[k * step];
            const wi = sin[k * step];
            const a = start + k;
            const b = a + half;
            const tr = re[b] * wr - im[b] * wi;
            const ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr;
            im[b] = im[a] - ti;
            re[a] += tr;
            im[a] += ti;
          }
        }
      }
    },
  };
}

/** The smallest power of two >= n. */
export const nextPow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
