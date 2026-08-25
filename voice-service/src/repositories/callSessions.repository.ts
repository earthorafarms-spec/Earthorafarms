import { supabase } from '../lib/supabaseClient.js';
import type { ConversationState } from '../conversation/state.js';

export type CallSessionStatus =
  | 'started' | 'discovering' | 'cart_building' | 'collecting_checkout'
  | 'checkout_ready' | 'link_sent' | 'ended'
  | 'handoff_unavailable' | 'abandoned' | 'failed';

export interface CallSessionRow {
  id: string;
  provider: 'browser' | 'tata_smartflo';
  status: CallSessionStatus;
  conversationState: ConversationState;
  expiresAt: string;
}

interface DbRow {
  id: string;
  provider: 'browser' | 'tata_smartflo';
  status: CallSessionStatus;
  conversation_state: ConversationState;
  expires_at: string;
}

function mapRow(row: DbRow): CallSessionRow {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    conversationState: row.conversation_state,
    expiresAt: row.expires_at,
  };
}

export async function createCallSession(
  initialState: ConversationState,
  provider: CallSessionRow['provider'] = 'browser'
): Promise<CallSessionRow> {
  const { data, error } = await supabase
    .from('voice_call_sessions')
    .insert({ provider, status: 'started', conversation_state: initialState })
    .select('id, provider, status, conversation_state, expires_at')
    .single();

  if (error) throw error;
  return mapRow(data as DbRow);
}

export async function getCallSession(id: string): Promise<CallSessionRow | null> {
  const { data, error } = await supabase
    .from('voice_call_sessions')
    .select('id, provider, status, conversation_state, expires_at')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapRow(data as DbRow);
}

export async function updateCallSessionState(
  id: string,
  state: ConversationState,
  status?: CallSessionStatus
): Promise<void> {
  const patch: Record<string, unknown> = { conversation_state: state };
  if (status) patch.status = status;

  const { error } = await supabase.from('voice_call_sessions').update(patch).eq('id', id);
  if (error) throw error;
}
