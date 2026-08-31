// The persisted shape of voice_call_sessions.conversation_state (jsonb).
// Kept as plain, easily-serializable data — no class instances, no
// server-local-only fields (this may be read back after a Render restart).

import type { SupportedLanguage } from './language.js';

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on assistant messages that requested tool calls. */
  toolCalls?: { id: string; name: string; argumentsJson: string }[];
  /** Present on tool-result messages, must match the toolCalls[].id it answers. */
  toolCallId?: string;
  /** Present on tool-result messages — the tool name that produced this result. */
  toolName?: string;
}

export interface CartSnapshotLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface CheckoutFieldSnapshot {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  gst?: string;
  couponCode?: string;
  marketingConsent?: boolean;
}

/**
 * Every tool result produced during the CURRENT turn only. output-policy.ts
 * checks the model's spoken reply against exactly this list before it goes
 * out — this is the concrete mechanism behind "never speak from model
 * memory, only from a live tool call made in this turn." It is rebuilt from
 * scratch every turn (see conversation/controller.ts) and is never carried
 * forward — a fact returned two turns ago is not a fact the model may state
 * on trust; it must call the tool again.
 */
export interface TurnToolFact {
  toolName: string;
  /** Raw JSON-stringified tool result, scanned verbatim by output-policy.ts. */
  resultJson: string;
}

export interface VoiceTurnMetric {
  routeTurnId: number;
  recordedAt: string;
  status: 'sent' | 'superseded' | 'transcript_rejected' | 'failed';
  audioMs: number;
  sttMs?: number;
  llmMs?: number;
  ttsMs?: number;
  firstAudioMs?: number;
  totalMs: number;
  responseSent: boolean;
  playbackCompletedAt?: string;
  playbackMs?: number;
  reason?: string;
}

export interface ConversationState {
  messages: ConversationMessage[];
  cart: CartSnapshotLine[];
  checkoutFields: CheckoutFieldSnapshot;
  turnCount: number;
  currentTurnFacts: TurnToolFact[];
  /**
   * Last confidently-detected language (see conversation/language.ts),
   * carried forward across turns where detection is uncertain (e.g. a bare
   * "yes") so a mid-conversation fallback/deflection line still comes out
   * in the language the caller has actually been using, not a default.
   */
  currentLanguage: SupportedLanguage;
  /**
   * Transport-level evidence for the most recent voice turns. This lives in
   * the existing JSONB conversation state, so delivery/cancellation latency
   * remains available after Render's short log-retention window without a
   * schema migration. Older sessions simply omit the property.
   */
  voiceTurnMetrics?: VoiceTurnMetric[];
}

export function createInitialState(): ConversationState {
  return {
    messages: [],
    cart: [],
    checkoutFields: {},
    turnCount: 0,
    currentTurnFacts: [],
    currentLanguage: 'en',
    voiceTurnMetrics: [],
  };
}
