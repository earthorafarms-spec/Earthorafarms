import { describe, expect, it } from 'vitest';
import { mulaw8kToPcm16k, pcm16ToMulawByte, wavToMulaw8k } from '../../src/telephony/mulaw.js';
import { writeWav } from '../../src/adapters/wav-utils.js';

describe('G.711 mu-law conversion', () => {
  it('encodes digital silence as 0xff', () => {
    expect(pcm16ToMulawByte(0)).toBe(0xff);
  });

  it('upsamples each 8 kHz mu-law sample into two PCM16 samples', () => {
    const pcm = mulaw8kToPcm16k(Buffer.from([0xff, 0x7f, 0xff]));
    expect(pcm).toHaveLength(12);
    expect(Math.abs(pcm.readInt16LE(0))).toBeLessThanOrEqual(1);
  });

  it('downsamples a PCM16 WAV to 8 kHz mu-law', () => {
    const pcm = Buffer.alloc(16000 * 2);
    for (let i = 0; i < 16000; i++) pcm.writeInt16LE(i % 2 ? 4000 : -4000, i * 2);
    const mulaw = wavToMulaw8k(writeWav(pcm, 16000, 16, 1));
    expect(mulaw).toHaveLength(8000);
  });
});
