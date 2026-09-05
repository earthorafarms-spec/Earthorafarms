-- Durable WhatsApp chatbot inbox. Apply after schema_agent.sql and
-- whatsapp_sessions.sql. The worker uses SKIP LOCKED, so multiple service
-- instances cannot process the same customer message concurrently.
BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_message_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id TEXT NOT NULL UNIQUE,
  phone_number        TEXT NOT NULL,
  message_text        TEXT,
  message_kind        TEXT NOT NULL DEFAULT 'text'
                      CHECK (message_kind IN ('text', 'unsupported')),
  reply_text          TEXT,
  processing_status   TEXT NOT NULL DEFAULT 'pending'
                      CHECK (processing_status IN ('pending', 'processing', 'reply_ready', 'processed', 'failed')),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_events_queue
  ON public.whatsapp_message_events(processing_status, next_attempt_at, created_at);

ALTER TABLE public.whatsapp_message_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service manage whatsapp_message_events" ON public.whatsapp_message_events;
CREATE POLICY "Service manage whatsapp_message_events"
  ON public.whatsapp_message_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.whatsapp_message_events FROM anon, authenticated;
GRANT ALL ON public.whatsapp_message_events TO service_role;

CREATE OR REPLACE FUNCTION public.claim_next_whatsapp_message()
RETURNS TABLE (
  id UUID,
  provider_message_id TEXT,
  phone_number TEXT,
  message_text TEXT,
  reply_text TEXT,
  attempt_count INTEGER
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  SELECT event.id INTO v_id
  FROM public.whatsapp_message_events event
  WHERE event.attempt_count < 5
    AND event.next_attempt_at <= now()
    -- Preserve per-customer ordering even when several Render instances are
    -- draining the inbox. A later message waits for every earlier retryable
    -- message from that phone to finish.
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_message_events earlier
      WHERE earlier.phone_number = event.phone_number
        AND (earlier.created_at, earlier.id) < (event.created_at, event.id)
        AND earlier.processing_status <> 'processed'
        AND earlier.attempt_count < 5
    )
    AND (
      event.processing_status IN ('pending', 'reply_ready', 'failed')
      OR (event.processing_status = 'processing' AND event.updated_at < now() - interval '5 minutes')
    )
  ORDER BY event.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  UPDATE public.whatsapp_message_events event
  SET processing_status = 'processing',
      attempt_count = event.attempt_count + 1,
      updated_at = now()
  WHERE event.id = v_id
  RETURNING event.id, event.provider_message_id, event.phone_number,
            event.message_text, event.reply_text, event.attempt_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_whatsapp_message_turn(
  p_event_id UUID,
  p_voice_session_id UUID,
  p_conversation_state JSONB,
  p_reply_text TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.voice_call_sessions
  SET conversation_state = p_conversation_state,
      expires_at = now() + interval '24 hours',
      updated_at = now()
  WHERE id = p_voice_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown WhatsApp voice session %', p_voice_session_id; END IF;

  UPDATE public.whatsapp_sessions
  SET last_active_at = now()
  WHERE voice_session_id = p_voice_session_id;

  UPDATE public.whatsapp_message_events
  SET reply_text = p_reply_text,
      processing_status = 'reply_ready',
      last_error = NULL,
      updated_at = now()
  WHERE id = p_event_id AND processing_status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'WhatsApp inbox event % is not claimed', p_event_id; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_whatsapp_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_whatsapp_message_turn(UUID, UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_whatsapp_message() TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_whatsapp_message_turn(UUID, UUID, JSONB, TEXT) TO service_role;

COMMIT;
