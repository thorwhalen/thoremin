/**
 * Browser WAV encoder — the in-house, dependency-free WAV converter for the
 * recording format registry. The live recording is captured as WebM/Opus (the
 * only container MediaRecorder produces natively); on stop we `decodeAudioData`
 * it into an `AudioBuffer` and re-encode here as 16-bit PCM WAV. This mirrors the
 * Node-only `scripts/lib_audio.ts` `writeWav` (RIFF/WAVE header layout) but
 * targets an `ArrayBuffer`/`Blob` and supports the buffer's real sample rate and
 * channel count, so it runs in the browser with no extra dependency.
 *
 * `encodeWav` takes a structural {@link PcmSource} (the subset of `AudioBuffer`
 * we use) so it is unit-testable headlessly without a real `AudioBuffer`.
 */

/** The slice of `AudioBuffer` the encoder reads (kept structural for testing). */
export interface PcmSource {
  numberOfChannels: number;
  sampleRate: number;
  /** Number of sample frames per channel. */
  length: number;
  getChannelData(channel: number): Float32Array;
}

const BYTES_PER_SAMPLE = 2; // 16-bit PCM

/** Encode interleaved 16-bit PCM WAV from an AudioBuffer-like source. */
export function encodeWav(audio: PcmSource): Blob {
  const channels = Math.max(1, audio.numberOfChannels);
  const sampleRate = audio.sampleRate;
  const frames = audio.length;
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const dataBytes = frames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c++) chans.push(audio.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      let s = chans[c][i] ?? 0;
      s = s < -1 ? -1 : s > 1 ? 1 : s; // clamp before quantizing
      view.setInt16(offset, Math.round(s * 32767), true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
