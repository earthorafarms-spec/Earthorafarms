import { supabase } from '../voice-service/src/lib/supabaseClient.js';
import { createInitialState } from '../voice-service/src/conversation/state.js';
import type { ConversationState } from '../voice-service/src/conversation/state.js';

// WhatsApp sessions live for 24 h of inactivity; each message resets the clock.
const SESSION_TTL_HOURS = 24;

function ttlTimestamp(): string {
  return new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60_000).toISOString();
}

export interface WhatsAppSessionResult {
  voiceSessionId: string;
  state: ConversationState;
}

/**
 * Returns the active session for this phone number, creating one if none
 * exists or the previous one has expired. The `voiceSessionId` is a
 * `voice_call_sessions` UUID — passed as `callSessionId` to `processTurn()`
 * so the checkout tool's FK to `voice_call_sessions` resolves correctly.
 */
export async function getOrCreateSession(phone: string): Promise<WhatsAppSessionResult> {
  // Look up existing whatsapp_sessions row for this phone.
  const { data: waRow } = await supabase
    .from('whatsapp_sessions')
    .select('voice_session_id')
    .eq('phone_number', phone)
    .maybeSingle();

  if (waRow) {
    // Check if the linked voice session is still alive.
    const { data: vsRow } = await supabase
      .from('voice_call_sessions')
      .select('id, conversation_state, expires_at')
      .eq('id', waRow.voice_session_id)
      .maybeSingle();

    if (vsRow && new Date(vsRow.expires_at as string) > new Date()) {
      return {
        voiceSessionId: vsRow.id as string,
        state: (vsRow.conversation_state as ConversationState) ?? createInitialState(),
      };
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
      { phone_number: phone, voice_session_id: vsNew.id, last_active_at: new Date().toISOString() },
      { onConflict: 'phone_number' }
    );

  if (waErr) {
    throw new Error(`whatsapp: failed to upsert session lookup: ${waErr.message}`);
  }

  return { voiceSessionId: vsNew.id as string, state: initialState };
}

/** Persist updated conversation state and extend the session TTL. */
export async function updateSessionState(voiceSessionId: string, state: ConversationState): Promise<void> {
  const [vsErr, waErr] = await Promise.all([
    supabase
      .from('voice_call_sessions')
      .update({ conversation_state: state, expires_at: ttlTimestamp() })
      .eq('id', voiceSessionId)
      .then(({ error }) => error),
    supabase
      .from('whatsapp_sessions')
      .update({ last_active_at: new Date().toISOString() })
      .eq('voice_session_id', voiceSessionId)
      .then(({ error }) => error),
  ]);

  if (vsErr) throw new Error(`whatsapp: failed to update session state: ${vsErr.message}`);
  if (waErr) throw new Error(`whatsapp: failed to update last_active_at: ${waErr.message}`);
}
