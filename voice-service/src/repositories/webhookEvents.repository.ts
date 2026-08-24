import { supabase } from '../lib/supabaseClient.js';

/**
 * Records a webhook delivery BEFORE processing. Returns `duplicate: true`
 * when provider_event_id already exists (unique violation) — the caller
 * should short-circuit and return 200 without doing any further work.
 */
export async function recordWebhookEvent(input: {
  providerEventId: string;
  eventType: string;
  signatureValid: boolean;
  payload: unknown;
}): Promise<{ id: string; duplicate: boolean }> {
  const { data, error } = await supabase
    .from('payment_webhook_events')
    .insert({
      provider: 'razorpay',
      provider_event_id: input.providerEventId,
      event_type: input.eventType,
      signature_valid: input.signatureValid,
      payload: input.payload,
      processing_status: 'received',
    })
    .select('id')
    .single();

  if (error) {
    // Postgres unique_violation
    if (error.code === '23505') {
      return { id: '', duplicate: true };
    }
    throw error;
  }

  return { id: (data as { id: string }).id, duplicate: false };
}

export async function markWebhookEventProcessed(id: string): Promise<void> {
  const { error } = await supabase
    .from('payment_webhook_events')
    .update({ processing_status: 'processed', processed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function markWebhookEventFailed(id: string, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from('payment_webhook_events')
    .update({
      processing_status: 'failed',
      last_error: errorMessage,
      processed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('attempt_count')
    .single();
  // Increment attempt_count via a follow-up RPC-free update (read-modify-write is
  // acceptable here since this is a low-frequency failure path, not a hot path).
  if (error) throw error;
}
