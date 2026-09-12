import { supabase } from '../voice-service/src/lib/supabaseClient.js';
import { createInitialState } from '../voice-service/src/conversation/state.js';
import type { ConversationState, ConversationMessage } from '../voice-service/src/conversation/state.js';

// WhatsApp sessions live for 24 h of inactivity; each message resets the clock.
const SESSION_TTL_HOURS = 24;

function ttlTimestamp(): string {
  return new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60_000).toISOString();
}

function isUnexpired(timestamp: unknown): timestamp is string {
  return typeof timestamp === 'string' && Date.parse(timestamp) > Date.now();
}

export interface WhatsAppSessionResult {
  voiceSessionId: string;
  state: ConversationState;
}

/**
 * Sanitizes WhatsApp persisted message history so that orphan/malformed role:"tool"
 * messages (e.g. from historical checkout-direct flows) are omitted before reaching
 * turn processing or OpenAI.
 *
 * Rules:
 * - Preserves valid assistant -> tool-call -> tool message sequences.
 * - Removes only orphan/malformed role:"tool" messages that do not immediately follow
 *   an assistant message containing a matching tool_call.
 * - Does not invent tool_calls or modify valid messages.
 */
export function sanitizeWhatsAppSessionMessages(messages: ConversationMessage[]): ConversationMessage[] {
  const result: ConversationMessage[] = [];
  let pendingToolCallIds: Set<string> | null = null;

  for (const m of messages) {
    if (m.role === 'tool') {
      if (m.toolCallId && pendingToolCallIds?.has(m.toolCallId)) {
        pendingToolCallIds.delete(m.toolCallId);
        result.push(m);
      }
      // Omit orphan/malformed tool message
      continue;
    }

    if (m.role === 'assistant') {
      const toolCalls = m.toolCalls && m.toolCalls.length > 0 ? m.toolCalls : undefined;
      if (toolCalls) {
        pendingToolCallIds = new Set(toolCalls.map((tc) => tc.id).filter(Boolean));
      } else {
        pendingToolCallIds = null;
      }
      result.push(m);
      continue;
    }

    // Any other role (user, system) breaks active tool call sequence
    pendingToolCallIds = null;
    result.push(m);
  }

  return result;
}

export function sanitizeWhatsAppConversationState(state: ConversationState): ConversationState {
  const initial = createInitialState();
  if (!state || typeof state !== 'object') return initial;
  return {
    ...initial,
    ...state,
    checkoutFields: {
      ...initial.checkoutFields,
      ...(state.checkoutFields ?? {}),
    },
    cart: Array.isArray(state.cart) ? state.cart : initial.cart,
    messages: Array.isArray(state.messages)
      ? sanitizeWhatsAppSessionMessages(state.messages)
      : initial.messages,
  };
}

/**
 * Returns the active session for this phone number, creating one if none
 * exists or the previous one has expired. The `voiceSessionId` is a
 * `voice_call_sessions` UUID — passed as `callSessionId` to `processTurn()`
 * so the checkout tool's FK to `voice_call_sessions` resolves correctly.
 */
export async function getOrCreateSession(phone: string): Promise<WhatsAppSessionResult> {
  // Look up existing whatsapp_sessions row and linked voice session in a single read.
  const { data: waRow } = await supabase
    .from('whatsapp_sessions')
    .select(`
      voice_session_id,
      voice_call_sessions (
        id,
        conversation_state,
        expires_at
      )
    `)
    .eq('phone_number', phone)
    .maybeSingle();

  if (waRow) {
    const rawVs = (waRow as Record<string, any>).voice_call_sessions;
    const vsRow = (Array.isArray(rawVs) ? rawVs[0] : rawVs) as {
      id?: string;
      conversation_state?: unknown;
      expires_at?: string;
    } | null | undefined;

    if (vsRow && isUnexpired(vsRow.expires_at)) {
      return {
        voiceSessionId: (vsRow.id ?? waRow.voice_session_id) as string,
        state: sanitizeWhatsAppConversationState(vsRow.conversation_state as ConversationState),
      };
    }

    // Graceful fallback if embedded relation was not returned
    if (!vsRow && waRow.voice_session_id) {
      const { data: directVs } = await supabase
        .from('voice_call_sessions')
        .select('id, conversation_state, expires_at')
        .eq('id', waRow.voice_session_id)
        .maybeSingle();

      if (directVs && isUnexpired(directVs.expires_at)) {
        return {
          voiceSessionId: directVs.id as string,
          state: sanitizeWhatsAppConversationState(directVs.conversation_state as ConversationState),
        };
      }
    }
  }

  // No session or expired — create a fresh voice_call_sessions row.
  const initialState = createInitialState();
  const { data: vsNew, error: vsErr } = await supabase
    .from('voice_call_sessions')
    .insert({
      provider: 'whatsapp',
      status: 'started',
      locale: 'en-IN',
      conversation_state: initialState,
      expires_at: ttlTimestamp(),
    })
    .select('id')
    .single();

  if (vsErr || !vsNew) {
    throw new Error(`whatsapp: failed to create voice session: ${vsErr?.message}`);
  }

  // Upsert the whatsapp_sessions lookup row.
  const { error: waErr } = await supabase
    .from('whatsapp_sessions')
    .upsert(
      {
        phone_number: phone,
        voice_session_id: vsNew.id,
        last_active_at: new Date().toISOString(),
        flow_timeout_at: null,
        flow_turn_count: null,
        flow_timeout_kind: null,
      },
      { onConflict: 'phone_number' }
    );

  if (waErr) {
    throw new Error(`whatsapp: failed to upsert session lookup: ${waErr.message}`);
  }

  return { voiceSessionId: vsNew.id as string, state: initialState };
}
