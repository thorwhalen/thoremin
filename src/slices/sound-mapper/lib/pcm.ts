/**
 * Taught taps as text: 16-bit little-endian PCM in base64, so a sound map is one JSON record
 * (localStorage holds it; a 70 ms tap at 48 kHz is about 9 kB). Pure.
 */

export function encodePcm16(pcm: Float32Array): string {
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), true);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function decodePcm16(b64: string): Float32Array {
  const s = atob(b64);
  const out = new Float32Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const v = s.charCodeAt(2 * i) | (s.charCodeAt(2 * i + 1) << 8);
    out[i] = (v >= 0x8000 ? v - 0x10000 : v) / 32767;
  }
  return out;
}
