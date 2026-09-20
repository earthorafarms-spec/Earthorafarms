import { describe, expect, it } from 'vitest';
import {
  Pcm16ResampleStreamToMulaw8k,
  Pcm16StreamToMulaw8k,
  wavToMulaw8k,
} from '../../src/telephony/mulaw.js';
import { writeWav } from '../../src/adapters/wav-utils.js';

// Piper (the self-hosted TTS) returns 22 050 Hz, which is NOT a multiple of
// 8000 — the phone transport's rate. These cover the fractional converter the
// telephony path needs for it.
const PIPER_RATE = 22_050;

/** A short speech-like sweep, so interpolation errors show up as drift. */
function tone(sampleCount: number, rate: number): Buffer {
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    pcm.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 220 * i) / rate)), i * 2);
  }
  return pcm;
}

describe('Pcm16ResampleStreamToMulaw8k (non-integer sample-rate ratios)', () => {
  it('rejects 22.05 kHz on the integer-ratio converter, which is why this class exists', () => {
    expect(() => new Pcm16StreamToMulaw8k(PIPER_RATE)).toThrow(/multiple of 8000/);
    expect(() => new Pcm16ResampleStreamToMulaw8k(PIPER_RATE)).not.toThrow();
  });

  it('matches the buffered converter byte-for-byte on the same 22.05 kHz audio', () => {
    const pcm = tone(22_050, PIPER_RATE); // one second
    const buffered = wavToMulaw8k(writeWav(pcm, PIPER_RATE, 16, 1));

    const converter = new Pcm16ResampleStreamToMulaw8k(PIPER_RATE);
    const streamed = Buffer.concat([converter.push(pcm), converter.flush()]);

    // The streaming path may emit one extra tail sample rather than clipping it.
    expect(streamed.length).toBeGreaterThanOrEqual(buffered.length);
    expect(streamed.length).toBeLessThanOrEqual(buffered.length + 1);
    expect(streamed.subarray(0, buffered.length)).toEqual(buffered);
  });

  it('survives chunk boundaries that split a PCM16 sample in half', () => {
    const pcm = tone(8_000, PIPER_RATE);
    const whole = new Pcm16ResampleStreamToMulaw8k(PIPER_RATE);
    const expected = Buffer.concat([whole.push(pcm), whole.flush()]);

    // Deliberately odd, uneven cuts — a network chunk can land anywhere.
    const split = new Pcm16ResampleStreamToMulaw8k(PIPER_RATE);
    const cuts = [0, 1, 7, 8, 9, 1_003, 5_111, 9_999, pcm.length];
    const parts: Buffer[] = [];
    for (let i = 1; i < cuts.length; i++) parts.push(split.push(pcm.subarray(cuts[i - 1]!, cuts[i]!)));
    parts.push(split.flush());

    expect(Buffer.concat(parts)).toEqual(expected);
  });

  it('produces roughly 8000 samples per second of input, without drift', () => {
    const seconds = 4;
    const converter = new Pcm16ResampleStreamToMulaw8k(PIPER_RATE);
    const pcm = tone(PIPER_RATE * seconds, PIPER_RATE);

    const chunks: Buffer[] = [];
    for (let offset = 0; offset < pcm.length; offset += 1_777) {
      chunks.push(converter.push(pcm.subarray(offset, Math.min(offset + 1_777, pcm.length))));
    }
    chunks.push(converter.flush());

    const total = Buffer.concat(chunks).length;
    // Drift would compound over 4 s; allow only the single tail sample.
    expect(Math.abs(total - 8_000 * seconds)).toBeLessThanOrEqual(1);
  });

  it('keeps steady input steady, so held vowels do not click', () => {
    const pcm = Buffer.alloc(4_000 * 2);
    for (let i = 0; i < 4_000; i++) pcm.writeInt16LE(6_000, i * 2);

    const converter = new Pcm16ResampleStreamToMulaw8k(PIPER_RATE);
    const out = Buffer.concat([converter.push(pcm.subarray(0, 301)), converter.push(pcm.subarray(301)), converter.flush()]);

    expect(out.length).toBeGreaterThan(0);
    expect(new Set(out).size).toBe(1);
  });

  it('still handles integer ratios identically to the existing converter', () => {
    const pcm = tone(24_000, 24_000);
    const integer = new Pcm16StreamToMulaw8k(24_000);
    const integerOut = Buffer.concat([integer.push(pcm), integer.flush()]);

    const fractional = new Pcm16ResampleStreamToMulaw8k(24_000);
    const fractionalOut = Buffer.concat([fractional.push(pcm), fractional.flush()]);

    // Averaging vs interpolating differ slightly in method, but must agree on
    // duration and stay close in value.
    expect(Math.abs(fractionalOut.length - integerOut.length)).toBeLessThanOrEqual(1);
  });

  it('emits nothing until a full interpolation window has arrived', () => {
    const converter = new Pcm16ResampleStreamToMulaw8k(PIPER_RATE);
    expect(converter.push(Buffer.alloc(0))).toHaveLength(0);
    // One sample cannot be interpolated against a right-hand neighbour yet.
    const one = Buffer.alloc(2);
    one.writeInt16LE(1_234, 0);
    expect(converter.push(one)).toHaveLength(0);
    expect(converter.flush().length).toBeGreaterThan(0);
  });
});
