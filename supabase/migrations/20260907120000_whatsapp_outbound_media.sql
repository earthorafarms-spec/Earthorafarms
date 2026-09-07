-- Durable two-stage WhatsApp delivery for product image followed by text.
-- The public image URL is saved before delivery so retries never re-run the
-- customer's conversational turn or cart mutation.
BEGIN;

ALTER TABLE public.whatsapp_message_events
  ADD COLUMN IF NOT EXISTS outbound_media_url TEXT,
  ADD COLUMN IF NOT EXISTS outbound_media_caption TEXT,
  ADD COLUMN IF NOT EXISTS media_sent_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.complete_whatsapp_message_turn_v2(
  p_event_id UUID,
  p_voice_session_id UUID,
  p_conversation_state JSONB,
  p_reply_text TEXT,
  p_outbound_media_url TEXT,
  p_outbound_media_caption TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.voice_call_sessions
  SET conversation_state = p_conversation_state,
      expires_at = now() + interval '24 hours',
      updated_at = now()
  WHERE id = p_voice_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown WhatsApp voice session %', p_voice_session_id; END IF;

  UPDATE public.whatsapp_sessions
  SET last_active_at = now(),
      updated_at = now()
  WHERE voice_session_id = p_voice_session_id;

  UPDATE public.whatsapp_message_events
  SET reply_text = p_reply_text,
      outbound_media_url = p_outbound_media_url,
      outbound_media_caption = p_outbound_media_caption,
      media_sent_at = NULL,
      processing_status = 'reply_ready',
      last_error = NULL,
      updated_at = now()
  WHERE id = p_event_id AND processing_status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'WhatsApp inbox event % is not claimed', p_event_id; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_whatsapp_message_turn_v2(UUID, UUID, JSONB, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_whatsapp_message_turn_v2(UUID, UUID, JSONB, TEXT, TEXT, TEXT)
  TO service_role;

COMMIT;
