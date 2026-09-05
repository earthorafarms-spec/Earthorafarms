// Server-side turn detector: decides when a caller has finished speaking
// from silence alone, so the browser client never needs a push-to-talk
// button — audio streams continuously and this decides the boundaries.
//
// Concept adapted from the reference project at D:\Work\Sun\Agent
// (src/telephony/audio-accumulator.ts) — that implementation adapts its
// silence threshold per checkout field (longer tolerance while collecting
// a spoken phone number, since digits come in groups with pauses). This
// version is deliberately simpler: this system collects checkout fields via
// LLM tool-calling inside natural conversation, not a hardcoded field-by-
// field state machine, so there's no equivalent "current field" signal to
// adapt against — one reasonable fixed threshold covers it. Everything
// else (RMS energy gate, minimum-speech-before-flush, silence-to-flush,
// max-utterance safety cap) is the same underlying idea, reimplemented
// clean for this codebase rather than copied.

const SAMPLE_RATE = 16_000; // 16-bit mono PCM, matches what the browser client captures and what Sarvam STT works best with
const BYTES_PER_SAMPLE = 2;

// Telephone speech is substantially quieter than browser microphone PCM.
// Keep the default conservative but configurable per deployment, and retain
// a short pre-roll so leading consonants below the gate are not clipped.
const DEFAULT_SPEECH_RMS_THRESHOLD = 600;
// Keep interruption confirmation stricter than listening-window answers.
// A telephone "yes"/"two" can have less than 200ms above the energy gate.
const MIN_SPEECH_MS_BEFORE_FLUSH = 200;
const SHORT_ANSWER_MIN_SPEECH_MS = 80;
// 700ms of continuous silence after speech → flush. Natural intra-sentence
// pauses (breath, hesitation between clauses) are typically 200-500ms, so
// 700ms avoids splitting one thought into two turns while still feeling
// responsive after the user actually finishes speaking. 300ms was too
// aggressive — it was flushing mid-sentence pauses as if the turn had ended.
const SILENCE_MS_TO_FLUSH = 700;
const MAX_UTTERANCE_MS = 20_000; // safety cap — force-flush a runaway utterance rather than buffer forever
const PRE_ROLL_MS = 200;

function msToBytes(ms: number): number {
  return Math.round((ms / 1000) * SAMPLE_RATE * BYTES_PER_SAMPLE);
}

function rms(chunk: Buffer): number {
  if (chunk.length < 2) return 0;
  let sumSquares = 0;
  const sampleCount = Math.floor(chunk.length / 2);
  for (let i = 0; i < sampleCount; i++) {
    const sample = chunk.readInt16LE(i * 2);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / sampleCount);
}

export type UtteranceReadyCallback = (pcm16Mono16k: Buffer) => void;

export interface AudioAccumulatorOptions {
  speechRmsThreshold?: number;
  /** Snapshot at speech onset: accept brief answers only while the bot is listening. */
  allowShortUtterances?: () => boolean;
  onSpeechStart?: () => void;
  /** Called for every above-threshold chunk, including short noise bursts. */
  onSpeechActivity?: () => void;
}

/**
 * Feed raw PCM16 mono 16kHz chunks in via `push()` as they arrive from the
 * WebSocket. Calls `onUtteranceReady` with the accumulated speech buffer
 * once enough trailing silence confirms the caller has stopped talking.
 * One instance per active call/session — not shared across sessions.
 */
export class AudioAccumulator {
  private speechBuffer: Buffer[] = [];
  private preRollBuffer: Buffer[] = [];
  private preRollMs = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private hasSpeechStarted = false;
  private speechStartNotified = false;
  private minimumSpeechMs = MIN_SPEECH_MS_BEFORE_FLUSH;
  private utteranceMs = 0;

  private readonly speechRmsThreshold: number;

  constructor(
    private readonly onUtteranceReady: UtteranceReadyCallback,
    private readonly options: AudioAccumulatorOptions = {}
  ) {
    this.speechRmsThreshold = options.speechRmsThreshold ?? DEFAULT_SPEECH_RMS_THRESHOLD;
  }

  push(chunk: Buffer): void {
    const chunkMs = (chunk.length / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000;
    const energy = rms(chunk);
    const isSpeech = energy >= this.speechRmsThreshold;

    if (isSpeech) {
      this.options.onSpeechActivity?.();
      if (!this.hasSpeechStarted) {
        this.hasSpeechStarted = true;
        this.minimumSpeechMs = this.options.allowShortUtterances?.()
          ? SHORT_ANSWER_MIN_SPEECH_MS : MIN_SPEECH_MS_BEFORE_FLUSH;
        this.speechBuffer.push(...this.preRollBuffer, chunk);
        this.preRollBuffer = [];
        this.preRollMs = 0;
      } else {
        this.speechBuffer.push(chunk);
      }
      this.speechMs += chunkMs;
      this.silenceMs = 0;
      // Do not interrupt bot playback on the first loud packet. Telephone
      // clicks and brief line noise were previously treated as barge-in and
      // could clear a perfectly valid response halfway through. Confirm the
      // stronger 200ms barge-in threshold even when listening accepts short answers.
      if (!this.speechStartNotified && this.speechMs >= MIN_SPEECH_MS_BEFORE_FLUSH) {
        this.speechStartNotified = true;
        this.options.onSpeechStart?.();
      }
    } else if (this.hasSpeechStarted) {
      // Keep buffering brief silence too — it's part of natural speech
      // cadence and Sarvam's STT should see it, not a hard cut mid-word.
      this.speechBuffer.push(chunk);
      this.silenceMs += chunkMs;
    } else {
      this.addPreRoll(chunk, chunkMs);
    }

    if (this.hasSpeechStarted) this.utteranceMs += chunkMs;
    const enoughSpeech = this.speechMs >= this.minimumSpeechMs;
    const longEnoughSilence = this.silenceMs >= SILENCE_MS_TO_FLUSH;
    const tooLong = this.utteranceMs >= MAX_UTTERANCE_MS;

    // Discard a short cough/click after a full silence window instead of
    // carrying it forward and combining it with the caller's next sentence.
    if (this.hasSpeechStarted && longEnoughSilence && !enoughSpeech) {
      this.reset();
      return;
    }

    if (this.hasSpeechStarted && enoughSpeech && (longEnoughSilence || tooLong)) {
      this.flush();
    }
  }

  /** Force-flush whatever's buffered — used on WS close so a final partial utterance isn't lost. */
  flushIfPending(): void {
    if (this.hasSpeechStarted && this.speechMs >= this.minimumSpeechMs) {
      this.flush();
    } else {
      this.reset();
    }
  }

  private flush(): void {
    const combined = Buffer.concat(this.speechBuffer);
    this.reset();
    this.onUtteranceReady(combined);
  }

  private reset(): void {
    this.speechBuffer = [];
    this.preRollBuffer = [];
    this.preRollMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.hasSpeechStarted = false;
    this.speechStartNotified = false;
    this.utteranceMs = 0;
  }

  private addPreRoll(chunk: Buffer, chunkMs: number): void {
    this.preRollBuffer.push(chunk);
    this.preRollMs += chunkMs;
    while (this.preRollMs > PRE_ROLL_MS && this.preRollBuffer.length > 1) {
      const removed = this.preRollBuffer.shift();
      if (!removed) break;
      this.preRollMs -= (removed.length / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1_000;
    }
  }
}

export function pcm16ToWav(pcm: Buffer, sampleRate: number = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28); // byte rate
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}
