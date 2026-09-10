import { supabase } from '../voice-service/src/lib/supabaseClient.js';
import type { ConversationState } from '../voice-service/src/conversation/state.js';
import { getWhatsAppActiveSubFlow } from '../voice-service/src/conversation/controller.js';
import type { WhatsAppInboundMessage } from './inbound.js';
import { serializeProductCard, type WhatsAppProductCard } from './product-card.js';

export interface WhatsAppInboxEvent {
  id: string;
  providerMessageId: string;
  phone: string;
  messageText: string | null;
  replyText: string | null;
  mediaUrl: string | null;
  mediaCaption: string | null;
  mediaSentAt: string | null;
  attemptCount: number;
}

export async function enqueueWhatsAppMessage(message: WhatsAppInboundMessage): Promise<boolean> {
  const { error } = await supabase.from('whatsapp_message_events').insert({
    provider_message_id: message.providerMessageId,
    phone_number: message.phone,
    message_text: message.text,
    message_kind: message.kind,
    processing_status: 'pending',
  });

  if (!error) return true;
  if (error.code === '23505') return false;
  throw new Error(`whatsapp: failed to enqueue message: ${error.message}`);
}

export async function claimNextWhatsAppMessage(): Promise<WhatsAppInboxEvent | null> {
  const { data, error } = await supabase.rpc('claim_next_whatsapp_message');
  if (error) throw new Error(`whatsapp: failed to claim inbox event: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const rawRow = row as Record<string, any>;
  if (rawRow.outbound_media_url !== undefined) {
    return {
      id: rawRow.id,
      providerMessageId: rawRow.provider_message_id,
      phone: rawRow.phone_number,
      messageText: rawRow.message_text,
      replyText: rawRow.reply_text,
      mediaUrl: rawRow.outbound_media_url,
      mediaCaption: rawRow.outbound_media_caption,
      mediaSentAt: rawRow.media_sent_at,
      attemptCount: Number(rawRow.attempt_count),
    };
  }

  const { data:delivery, error: deliveryError } = await supabase
    .from('whatsapp_message_events')
    .select('outbound_media_url, outbound_media_caption, media_sent_at')
    .eq('id', row.id)
    .single();
  if (deliveryError) throw new Error(`whatsapp: failed to load outbound delivery state: ${deliveryError.message}`);
  return {
    id: row.id,
    providerMessageId: row.provider_message_id,
    phone: row.phone_number,
    messageText: row.message_text,
    replyText: row.reply_text,
    mediaUrl: delivery.outbound_media_url,
    mediaCaption: delivery.outbound_media_caption,
    mediaSentAt: delivery.media_sent_at,
    attemptCount: Number(row.attempt_count),
  };
}

export async function saveWhatsAppTurn(
  eventId: string,
  voiceSessionId: string,
  state: ConversationState,
  replyText: string,
  media?: { url: string; caption: string },
  productCard?: WhatsAppProductCard,
): Promise<void> {
  const activeSubFlow = getWhatsAppActiveSubFlow(state, replyText);
  const flowTimeoutAt = activeSubFlow ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
  const flowTurnCount = activeSubFlow ? state.turnCount : null;
  const flowTimeoutKind = activeSubFlow ?? null;

  const persistedMedia = productCard
    ? { url: productCard.imageUrl ?? '', caption: serializeProductCard(productCard) }
    : media;
  const { error } = await supabase.rpc('complete_whatsapp_message_turn_v2', {
    p_event_id: eventId,
    p_voice_session_id: voiceSessionId,
    p_conversation_state: state,
    p_reply_text: replyText,
    p_outbound_media_url: persistedMedia?.url ?? null,
    p_outbound_media_caption: persistedMedia?.caption ?? null,
    p_flow_timeout_at: flowTimeoutAt,
    p_flow_turn_count: flowTurnCount,
    p_flow_timeout_kind: flowTimeoutKind,
  });
  if (error) throw new Error(`whatsapp: failed to save completed turn: ${error.message}`);
}

export interface ClaimedFlowTimeout {
  eventId: string;
  phoneNumber: string;
  voiceSessionId: string;
  flowTurnCount: number;
  flowTimeoutKind: string;
  replyText: string;
}

export async function claimExpiredWhatsAppFlowTimeout(): Promise<ClaimedFlowTimeout | null> {
  const { data, error } = await supabase.rpc('claim_expired_whatsapp_flow_timeout');
  if (error) throw new Error(`whatsapp: failed to claim expired flow timeout: ${error.message}`);
  if (!data || !Array.isArray(data) || data.length === 0) {
    return null;
  }
  const row = data[0] as Record<string, any>;
  return {
    eventId: String(row.event_id),
    phoneNumber: String(row.phone_number),
    voiceSessionId: String(row.voice_session_id),
    flowTurnCount: Number(row.flow_turn_count),
    flowTimeoutKind: String(row.flow_timeout_kind),
    replyText: String(row.reply_text),
  };
}

export async function markWhatsAppMediaSent(eventId: string): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_message_events')
    .update({ media_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', eventId);
  if (error) throw new Error(`whatsapp: failed to mark media sent: ${error.message}`);
}

export async function markWhatsAppMessageProcessed(eventId: string): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_message_events')
    .update({ processing_status: 'processed', processed_at: new Date().toISOString(), last_error: null })
    .eq('id', eventId);
  if (error) throw new Error(`whatsapp: failed to mark message processed: ${error.message}`);
}

export async function markWhatsAppMessageFailed(
  eventId: string,
  errorMessage: string,
  attemptCount: number,
): Promise<void> {
  const retryDelaySeconds = Math.min(300, 5 * (2 ** Math.max(0, attemptCount - 1)));
  const { error } = await supabase
    .from('whatsapp_message_events')
    .update({
      processing_status: 'failed',
      last_error: errorMessage.slice(0, 500),
      next_attempt_at: new Date(Date.now() + retryDelaySeconds * 1_000).toISOString(),
    })
    .eq('id', eventId);
  if (error) throw new Error(`whatsapp: failed to record processing error: ${error.message}`);
}
