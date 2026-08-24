// Shared WAV container helpers used by SarvamTtsAdapter and OpenAiTtsAdapter.
// Both adapters produce per-sentence audio and stitch it back into one WAV
// file so the caller always gets a single playable buffer regardless of how
// many TTS calls were made internally.

export interface ParsedWav {
  pcm: Buffer;
  sampleRate: number;
  bitsPerSample: number;
  numChannels: number;
}

// Scan for the `data` chunk rather than assuming a fixed 44-byte header —
// some encoders prepend an extra LIST/INFO chunk which shifts audio start.
export function parseWav(wav: Buffer): ParsedWav {
  const numChannels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const bitsPerSample = wav.readUInt16LE(34);

  let offset = 12; // past "RIFF" + size + "WAVE"
  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString('ascii', offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      return { pcm: wav.subarray(offset + 8, offset + 8 + chunkSize), sampleRate, bitsPerSample, numChannels };
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  throw new Error('WAV buffer has no data chunk.');
}

export function writeWav(pcm: Buffer, sampleRate: number, bitsPerSample: number, numChannels: number): Buffer {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Splits text at sentence-ending punctuation followed by a capital letter or
// Indic script character. Returns the original string (in a one-element array)
// if fewer than 2 sentences are found, or if the total text is short enough
// that splitting wouldn't save meaningful time.
const SENTENCE_SPLIT_RE = /([.!?।])\s+(?=[A-Zऀ-ॿ઀-૿])/;
export const SPLIT_MIN_CHARS = 80;

export function splitSentences(text: string): string[] {
  const parts = text.split(SENTENCE_SPLIT_RE);
  const sentences: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const s = ((parts[i] ?? '') + (parts[i + 1] ?? '')).trim();
    if (s) sentences.push(s);
  }
  return sentences.length >= 2 && text.length > SPLIT_MIN_CHARS ? sentences : [text];
}

export function stitchWavs(wavBuffers: Buffer[], silenceGapMs: number): Buffer {
  const parsed = wavBuffers.map(parseWav);
  const { sampleRate, bitsPerSample, numChannels } = parsed[0];
  const silenceSamples = Math.floor((sampleRate * silenceGapMs) / 1000);
  const silence = Buffer.alloc(silenceSamples * (bitsPerSample / 8) * numChannels, 0);
  const pcmChunks: Buffer[] = [];
  parsed.forEach((seg, i) => {
    pcmChunks.push(seg.pcm);
    if (i < parsed.length - 1) pcmChunks.push(silence);
  });
  return writeWav(Buffer.concat(pcmChunks), sampleRate, bitsPerSample, numChannels);
}
