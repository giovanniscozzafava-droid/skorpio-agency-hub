/** Utility WAV: Gemini TTS restituisce PCM s16le mono 24 kHz. */
export const SAMPLE_RATE = 24000;
export function pcmToWav(pcm, sampleRate = SAMPLE_RATE, channels = 1) {
  const header = Buffer.alloc(44);
  const dataLen = pcm.length;
  header.write('RIFF', 0); header.writeUInt32LE(36 + dataLen, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}
export function wavToPcm(wav) { return wav.subarray(44); }
export function silence(seconds, sampleRate = SAMPLE_RATE) { return Buffer.alloc(Math.round(seconds * sampleRate) * 2); }
export function pcmDuration(pcm, sampleRate = SAMPLE_RATE) { return pcm.length / 2 / sampleRate; }
