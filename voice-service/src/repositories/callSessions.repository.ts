import { supabase } from '../lib/supabaseClient.js';
import type { ConversationState } from '../conversation/state.js';

export type CallSessionStatus =
  | 'started' | 'discovering' | 'cart_building' | 'collecting_checkout'
  | 'checkout_ready' | 'link_sent' | 'ended'
  | 'handoff_unavailable' | 'abandoned' | 'failed';

export interface CallSessionRow {
  id: string;
  provider: 'browser' | 'tata_smartflo' | 'whatsapp';
  providerCallId: string | null;
  status: CallSessionStatus;
  conversationState: ConversationState;
  expiresAt: string;
  startedAt: string;
  endedAt: string | null;
}

interface DbRow {
  id: string;
  provider: 'browser' | 'tata_smartflo' | 'whatsapp';
  provider_call_id: string | null;
  status: CallSessionStatus;
  conversation_state: ConversationState;
  expires_at: string;
  started_at: string;
  ended_at: string | null;
}

function mapRow(row: DbRow): CallSessionRow {
  return {
    id: row.id,
    provider: row.provider,
    providerCallId: row.provider_call_id,
    status: row.status,
    conversationState: row.conversation_state,
    expiresAt: row.expires_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export async function createCallSession(
  initialState: ConversationState,
  provider: CallSessionRow['provider'] = 'browser',
  options: { providerCallId?: string; locale?: string } = {}
): Promise<CallSessionRow> {
  const { data, error } = await supabase
    .from('voice_call_sessions')
    .insert({
      provider,
      status: 'started',
      conversation_state: initialState,
      ...(options.providerCallId && { provider_call_id: options.providerCallId }),
      ...(options.locale && { locale: options.locale }),
    })
    .select('id, provider, provider_call_id, status, conversation_state, expires_at, started_at, ended_at')
    .single();

  if (error) throw error;
  return mapRow(data as DbRow);
}

export async function getCallSession(id: string): Promise<CallSessionRow | null> {
  const { data, error } = await supabase
    .from('voice_call_sessions')
    .select('id, provider, provider_call_id, status, conversation_state, expires_at, started_at, ended_at')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapRow(data as DbRow);
}

export async function getCallSessionByProviderCallId(providerCallId: string): Promise<CallSessionRow | null> {
  const { data, error } = await supabase
    .from('voice_call_sessions')
    .select('id, provider, provider_call_id, status, conversation_state, expires_at, started_at, ended_at')
    .eq('provider_call_id', providerCallId)
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
  if (status && ['ended', 'abandoned', 'failed'].includes(status)) patch.ended_at = new Date().toISOString();

  const { error } = await supabase.from('voice_call_sessions').update(patch).eq('id', id);
  if (error) throw error;
}

export async function updateCallSessionStatus(id: string, status: CallSessionStatus): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (['ended', 'abandoned', 'failed'].includes(status)) patch.ended_at = new Date().toISOString();
  else patch.ended_at = null;
  const { error } = await supabase.from('voice_call_sessions').update(patch).eq('id', id);
  if (error) throw error;
}
