import { describe, it, expect, vi } from 'vitest';
import { AudioAccumulator, pcm16ToWav } from '../../src/telephony/audio-accumulator.js';

const SAMPLE_RATE = 16_000;

/** Builds a PCM16 mono chunk of `ms` milliseconds, either loud (speech-like) or silent. */
function chunk(ms: number, loud: boolean): Buffer {
  const sampleCount = Math.round((ms / 1000) * SAMPLE_RATE);
  const buf = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    // A loud sine-ish wave comfortably above the silence threshold; near-zero for silence.
    const value = loud ? (i % 2 === 0 ? 8000 : -8000) : 0;
    buf.writeInt16LE(value, i * 2);
  }
  return buf;
}

describe('AudioAccumulator', () => {
  it('does not flush on silence alone (no speech ever started)', () => {
    const onReady = vi.fn();
    const acc = new AudioAccumulator(onReady);
    for (let i = 0; i < 20; i++) acc.push(chunk(100, false)); // 2s of pure silence
    expect(onReady).not.toHaveBeenCalled();
  });

  it('flushes after enough speech followed by enough trailing silence', () => {
    const onReady = vi.fn();
    const acc = new AudioAccumulator(onReady);

    // 500ms of speech (> MIN_SPEECH_MS_BEFORE_FLUSH=300ms)
    for (let i = 0; i < 5; i++) acc.push(chunk(100, true));
    expect(onReady).not.toHaveBeenCalled(); // no trailing silence yet

    // 700ms of silence (> SILENCE_MS_TO_FLUSH=650ms) should trigger the flush
    for (let i = 0; i < 7; i++) acc.push(chunk(100, false));
    expect(onReady).toHaveBeenCalledTimes(1);

    const flushedBuffer = onReady.mock.calls[0][0] as Buffer;
    expect(flushedBuffer.length).toBeGreaterThan(0);
  });

  it('does NOT flush on a brief pause shorter than the silence threshold', () => {
    const onReady = vi.fn();
    const acc = new AudioAccumulator(onReady);

    for (let i = 0; i < 5; i++) acc.push(chunk(100, true)); // 500ms speech
    for (let i = 0; i < 3; i++) acc.push(chunk(100, false)); // only 300ms silence — below 650ms threshold
    expect(onReady).not.toHaveBeenCalled();

    // Resume speaking — the brief pause should NOT have flushed prematurely
    for (let i = 0; i < 5; i++) acc.push(chunk(100, true));
    expect(onReady).not.toHaveBeenCalled();
  });

  it('ignores a too-short blip (cough/click) that never reaches MIN_SPEECH_MS_BEFORE_FLUSH', () => {
    const onReady = vi.fn();
    const acc = new AudioAccumulator(onReady);

    acc.push(chunk(100, true)); // only 100ms of "speech" — below 300ms minimum
    for (let i = 0; i < 10; i++) acc.push(chunk(100, false)); // plenty of silence after
    expect(onReady).not.toHaveBeenCalled();
  });

  it('force-flushes a runaway utterance past the max duration safety cap', () => {
    const onReady = vi.fn();
    const acc = new AudioAccumulator(onReady);

    // 21 seconds of continuous speech, no pause — exceeds MAX_UTTERANCE_MS=20s
    for (let i = 0; i < 210; i++) acc.push(chunk(100, true));
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('flushIfPending flushes a valid in-progress utterance on connection close', () => {
    const onReady = vi.fn();
    const acc = new AudioAccumulator(onReady);
    for (let i = 0; i < 5; i++) acc.push(chunk(100, true)); // 500ms speech, no trailing silence yet
    expect(onReady).not.toHaveBeenCalled();

    acc.flushIfPending();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('flushIfPending does nothing when too little speech was buffered', () => {
    const onReady = vi.fn();
    const acc = new AudioAccumulator(onReady);
    acc.push(chunk(100, true)); // only 100ms — below minimum
    acc.flushIfPending();
    expect(onReady).not.toHaveBeenCalled();
  });
});

describe('pcm16ToWav', () => {
  it('produces a valid WAV header wrapping the given PCM data', () => {
    const pcm = chunk(100, true);
    const wav = pcm16ToWav(pcm);

    expect(wav.length).toBe(pcm.length + 44);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16_000); // sample rate
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.readUInt32LE(40)).toBe(pcm.length); // data chunk size
  });
});
