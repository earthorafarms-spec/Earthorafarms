import type { ConversationMessage } from '../conversation/state.js';
import type { SupportedLanguage } from '../conversation/language.js';
import type { ToolDefinition } from '../tools/types.js';

export interface LLMToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export type LLMTurnResult =
  | { kind: 'tool_calls'; calls: LLMToolCall[] }
  | { kind: 'message'; content: string };

/**
 * Vendor-neutral LLM seam — `conversation/controller.ts` only ever talks to
 * this interface, never to an OpenAI/Sarvam/etc. SDK directly. Mirrors the
 * STT/TTS adapter interfaces below and the `providers.ts` factory pattern:
 * one seam per capability, selected by an env var.
 */
export interface LLMAdapter {
  chatWithTools(messages: ConversationMessage[], tools: ToolDefinition[]): Promise<LLMTurnResult>;
}

export interface TranscriptionResult {
  text: string;
  /** Present only if the STT provider itself detects/reports a language (e.g. Sarvam's auto-detect). */
  detectedLanguage?: SupportedLanguage;
  /** Raw BCP-47 provider result, retained so unsupported languages can be rejected safely. */
  detectedLanguageCode?: string;
  /** Provider language confidence when auto-detection is used. */
  languageProbability?: number;
  /** True when the adapter retried a low-confidence/unsupported auto-detection with a language hint. */
  wasRetried?: boolean;
}

export interface SttAdapter {
  /**
   * Transcribes one utterance of raw audio into text. `languageHint`, if
   * given, is a hint (e.g. the conversation's current language) — providers
   * that support auto-detection (like Sarvam) may still return a different
   * `detectedLanguage` if the caller actually switched languages mid-call.
   * `format` tells the provider what container the bytes are in — the
   * text-mode browser recorder sends webm (MediaRecorder's default), the
   * WebSocket streaming route sends wav (raw PCM wrapped locally, since
   * there's no browser-side encoder in that path — see telephony/audio-accumulator.ts).
   */
  transcribe(audio: Buffer, opts?: { languageHint?: SupportedLanguage; format?: 'webm' | 'wav' }): Promise<TranscriptionResult>;
}

export interface TtsAdapter {
  /** Synthesizes speech audio for one piece of text, in the given language. Returns raw audio bytes. */
  synthesize(text: string, language: SupportedLanguage): Promise<Buffer>;
  /** Optional zero-transcode telephony output: raw G.711 mu-law, mono, 8 kHz. */
  synthesizeMulaw8k?(text: string, language: SupportedLanguage): Promise<Buffer>;
}

export class AdapterNotConfiguredError extends Error {
  constructor(adapterName: string, reason: string) {
    super(`${adapterName} is not configured — ${reason}`);
    this.name = 'AdapterNotConfiguredError';
  }
}
