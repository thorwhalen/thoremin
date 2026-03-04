/** Decode base64 string to Uint8Array */
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/** Convert raw PCM Int16 bytes to an AudioBuffer */
export function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number
): AudioBuffer {
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const numSamples = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, numSamples, sampleRate);

  // Convert Int16 to Float32 and deinterleave channels
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < numSamples; i++) {
      channelData[i] = dataInt16[i * numChannels + ch] / 32768.0;
    }
  }

  return buffer;
}
