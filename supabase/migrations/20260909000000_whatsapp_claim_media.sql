-- Fast-path outbound media delivery state returned directly from message claiming.
-- Removes redundant second SELECT query from worker inbox processing.
BEGIN;

DROP FUNCTION IF EXISTS public.claim_next_whatsapp_message();

CREATE OR REPLACE FUNCTION public.claim_next_whatsapp_message()
RETURNS TABLE (
  id UUID,
  provider_message_id TEXT,
  phone_number TEXT,
  message_text TEXT,
  reply_text TEXT,
  attempt_count INTEGER,
  outbound_media_url TEXT,
  outbound_media_caption TEXT,
  media_sent_at TIMESTAMPTZ
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
            event.message_text, event.reply_text, event.attempt_count,
            event.outbound_media_url, event.outbound_media_caption, event.media_sent_at;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_whatsapp_message() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_whatsapp_message() TO service_role;

COMMIT;
