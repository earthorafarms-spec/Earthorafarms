import { parseWav } from '../adapters/wav-utils.js';

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** Decode one G.711 mu-law byte to signed linear PCM16. */
export function mulawByteToPcm16(value: number): number {
  const mu = (~value) & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  const magnitude = ((mantissa << 3) + MULAW_BIAS) << exponent;
  return sign ? MULAW_BIAS - magnitude : magnitude - MULAW_BIAS;
}

/** Encode one signed linear PCM16 sample as G.711 mu-law. */
export function pcm16ToMulawByte(sample: number): number {
  let sign = 0;
  let magnitude = Math.max(-32768, Math.min(32767, Math.round(sample)));
  if (magnitude < 0) {
    sign = 0x80;
    magnitude = -magnitude;
  }
  magnitude = Math.min(MULAW_CLIP, magnitude) + MULAW_BIAS;

  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && (magnitude & mask) === 0; mask >>= 1) exponent--;
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

/** Convert 8 kHz mono G.711 mu-law to 16 kHz mono PCM16 for Sarvam STT. */
export function mulaw8kToPcm16k(mulaw: Buffer): Buffer {
  const output = Buffer.alloc(mulaw.length * 4);
  for (let i = 0; i < mulaw.length; i++) {
    const current = mulawByteToPcm16(mulaw[i]);
    const next = i + 1 < mulaw.length ? mulawByteToPcm16(mulaw[i + 1]) : current;
    output.writeInt16LE(current, i * 4);
    output.writeInt16LE(Math.round((current + next) / 2), i * 4 + 2);
  }
  return output;
}

/** Convert a PCM16 WAV returned by TTS to 8 kHz mono G.711 mu-law. */
export function wavToMulaw8k(wav: Buffer): Buffer {
  const parsed = parseWav(wav);
  if (parsed.bitsPerSample !== 16) throw new Error(`TTS WAV must be PCM16, got ${parsed.bitsPerSample}-bit.`);
  if (parsed.numChannels < 1) throw new Error('TTS WAV has no audio channels.');

  const frameBytes = parsed.numChannels * 2;
  const frameCount = Math.floor(parsed.pcm.length / frameBytes);
  const outputFrames = Math.max(1, Math.floor(frameCount * 8000 / parsed.sampleRate));
  const output = Buffer.alloc(outputFrames);

  for (let i = 0; i < outputFrames; i++) {
    const sourcePosition = i * parsed.sampleRate / 8000;
    const leftIndex = Math.min(frameCount - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(frameCount - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;

    let left = 0;
    let right = 0;
    for (let channel = 0; channel < parsed.numChannels; channel++) {
      left += parsed.pcm.readInt16LE(leftIndex * frameBytes + channel * 2);
      right += parsed.pcm.readInt16LE(rightIndex * frameBytes + channel * 2);
    }
    left /= parsed.numChannels;
    right /= parsed.numChannels;
    output[i] = pcm16ToMulawByte(left + (right - left) * fraction);
  }
  return output;
}

/**
 * Incrementally converts raw mono PCM16LE into 8 kHz G.711 mu-law.
 *
 * Streaming TTS responses may split a 16-bit sample across network chunks,
 * so the converter retains both an odd byte and an incomplete resampling
 * group between push calls. TTS sources currently use 24 kHz, an exact 3:1
 * ratio; averaging each group provides a small anti-aliasing improvement
 * over simply dropping two samples.
 */
export class Pcm16StreamToMulaw8k {
  private readonly samplesPerOutput: number;
  private byteCarry = Buffer.alloc(0);
  private sampleSum = 0;
  private sampleCount = 0;

  constructor(sourceSampleRate: number) {
    if (!Number.isInteger(sourceSampleRate) || sourceSampleRate < 8_000 || sourceSampleRate % 8_000 !== 0) {
      throw new Error(`PCM stream sample rate must be an integer multiple of 8000 Hz, got ${sourceSampleRate}.`);
    }
    this.samplesPerOutput = sourceSampleRate / 8_000;
  }

  push(chunk: Buffer): Buffer {
    if (chunk.length === 0) return Buffer.alloc(0);
    const input = this.byteCarry.length ? Buffer.concat([this.byteCarry, chunk]) : chunk;
    const completeBytes = input.length - (input.length % 2);
    this.byteCarry = completeBytes < input.length ? Buffer.from(input.subarray(completeBytes)) : Buffer.alloc(0);
    const output: number[] = [];

    for (let offset = 0; offset < completeBytes; offset += 2) {
      this.sampleSum += input.readInt16LE(offset);
      this.sampleCount++;
      if (this.sampleCount === this.samplesPerOutput) {
        output.push(pcm16ToMulawByte(this.sampleSum / this.sampleCount));
        this.sampleSum = 0;
        this.sampleCount = 0;
      }
    }
    return Buffer.from(output);
  }

  flush(): Buffer {
    // A dangling byte cannot form a PCM16 sample and is intentionally
    // discarded. Preserve a final partial sample group instead of clipping
    // the last few milliseconds of speech.
    this.byteCarry = Buffer.alloc(0);
    if (this.sampleCount === 0) return Buffer.alloc(0);
    const value = pcm16ToMulawByte(this.sampleSum / this.sampleCount);
    this.sampleSum = 0;
    this.sampleCount = 0;
    return Buffer.from([value]);
  }
}

/**
 * Incrementally converts raw mono PCM16LE at ANY sample rate >= 8 kHz into
 * 8 kHz G.711 mu-law.
 *
 * Pcm16StreamToMulaw8k above averages a whole number of input samples per
 * output sample, which only works when the source rate is a multiple of
 * 8000 (16 kHz and 24 kHz vendors). Piper returns 22 050 Hz, where
 * 22050 / 8000 = 2.75625, so each output sample falls BETWEEN two input
 * samples and that converter throws. This one linearly interpolates, using
 * the same position formula as wavToMulaw8k so a reply sounds identical
 * whether it was streamed or converted from a complete buffer.
 *
 * Each output position is derived from an absolute output index rather than
 * an accumulated step, so the mapping cannot drift over a long reply. Both an
 * odd trailing byte and the two-sample interpolation window survive across
 * chunk boundaries, so a sample split by the network does not click.
 */
export class Pcm16ResampleStreamToMulaw8k {
  private readonly sourceSampleRate: number;
  private byteCarry = Buffer.alloc(0);
  /** Held input samples; `head` is the first index still in use. */
  private samples: number[] = [];
  private head = 0;
  /** Absolute index of samples[head]. */
  private windowStart = 0;
  private outIndex = 0;

  constructor(sourceSampleRate: number) {
    if (!Number.isFinite(sourceSampleRate) || sourceSampleRate < 8_000) {
      throw new Error(`PCM stream sample rate must be at least 8000 Hz, got ${sourceSampleRate}.`);
    }
    this.sourceSampleRate = sourceSampleRate;
  }

  private positionFor(outIndex: number): number {
    return (outIndex * this.sourceSampleRate) / 8_000;
  }

  push(chunk: Buffer): Buffer {
    if (chunk.length === 0) return Buffer.alloc(0);
    const input = this.byteCarry.length ? Buffer.concat([this.byteCarry, chunk]) : chunk;
    const completeBytes = input.length - (input.length % 2);
    this.byteCarry = completeBytes < input.length
      ? Buffer.from(input.subarray(completeBytes))
      : Buffer.alloc(0);
    for (let offset = 0; offset < completeBytes; offset += 2) {
      this.samples.push(input.readInt16LE(offset));
    }
    return this.drain(false);
  }

  /**
   * Emits every output sample whose interpolation window is fully available.
   * When `final` is true the window is allowed to clamp to the last sample,
   * so the tail of the reply is not clipped.
   */
  private drain(final: boolean): Buffer {
    const output: number[] = [];
    const lastAbsolute = this.windowStart + (this.samples.length - this.head) - 1;
    if (lastAbsolute < this.windowStart) return Buffer.alloc(0);

    for (;;) {
      const position = this.positionFor(this.outIndex);
      const left = Math.floor(position);
      const right = left + 1;
      if (left > lastAbsolute) break;
      // A future chunk still has to supply the right-hand neighbour.
      if (right > lastAbsolute && !final) break;

      const a = this.samples[this.head + (left - this.windowStart)]!;
      const b = this.samples[this.head + (Math.min(right, lastAbsolute) - this.windowStart)]!;
      output.push(pcm16ToMulawByte(a + (b - a) * (position - left)));
      this.outIndex++;

      // Release samples no later output can reach, keeping one as the
      // left-hand neighbour of the next interpolation.
      const nextLeft = Math.min(Math.floor(this.positionFor(this.outIndex)), lastAbsolute);
      const release = nextLeft - this.windowStart;
      if (release > 0) {
        this.head += release;
        this.windowStart = nextLeft;
        // Compact occasionally so the held array cannot grow without bound.
        if (this.head > 4_096) {
          this.samples = this.samples.slice(this.head);
          this.head = 0;
        }
      }
    }
    return Buffer.from(output);
  }

  flush(): Buffer {
    // A dangling byte cannot form a PCM16 sample and is intentionally discarded.
    this.byteCarry = Buffer.alloc(0);
    const tail = this.drain(true);
    this.samples = [];
    this.head = 0;
    this.windowStart = 0;
    this.outIndex = 0;
    return tail;
  }
}
