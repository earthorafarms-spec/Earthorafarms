-- Migration: Add WhatsApp inactivity flow timeout and atomic claim function.
BEGIN;

-- 1. Add timeout columns to whatsapp_sessions
ALTER TABLE public.whatsapp_sessions
  ADD COLUMN IF NOT EXISTS flow_timeout_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flow_turn_count INTEGER,
  ADD COLUMN IF NOT EXISTS flow_timeout_kind TEXT;

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_flow_timeout
  ON public.whatsapp_sessions(flow_timeout_at)
  WHERE flow_timeout_at IS NOT NULL;

-- 2. Allow 'timeout' in whatsapp_message_events message_kind
ALTER TABLE public.whatsapp_message_events
  DROP CONSTRAINT IF EXISTS whatsapp_message_events_message_kind_check;

ALTER TABLE public.whatsapp_message_events
  ADD CONSTRAINT whatsapp_message_events_message_kind_check
  CHECK (message_kind IN ('text', 'unsupported', 'timeout'));

-- 3. Update complete_whatsapp_message_turn_v2
DROP FUNCTION IF EXISTS public.complete_whatsapp_message_turn_v2(UUID, UUID, JSONB, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.complete_whatsapp_message_turn_v2(
  p_event_id UUID,
  p_voice_session_id UUID,
  p_conversation_state JSONB,
  p_reply_text TEXT,
  p_outbound_media_url TEXT,
  p_outbound_media_caption TEXT,
  p_flow_timeout_at TIMESTAMPTZ DEFAULT NULL,
  p_flow_turn_count INTEGER DEFAULT NULL,
  p_flow_timeout_kind TEXT DEFAULT NULL
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
      flow_timeout_at = p_flow_timeout_at,
      flow_turn_count = p_flow_turn_count,
      flow_timeout_kind = p_flow_timeout_kind,
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

REVOKE ALL ON FUNCTION public.complete_whatsapp_message_turn_v2(UUID, UUID, JSONB, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_whatsapp_message_turn_v2(UUID, UUID, JSONB, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT)
  TO service_role;

-- 4. Atomic claim for expired WhatsApp flow timeouts
CREATE OR REPLACE FUNCTION public.claim_expired_whatsapp_flow_timeout()
RETURNS TABLE (
  event_id UUID,
  phone_number TEXT,
  voice_session_id UUID,
  flow_turn_count INTEGER,
  flow_timeout_kind TEXT,
  reply_text TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone TEXT;
  v_vs_id UUID;
  v_turn_count INTEGER;
  v_kind TEXT;
  v_state JSONB;
  v_lang TEXT;
  v_reply TEXT;
  v_new_state JSONB;
  v_messages JSONB;
  v_event_id UUID;
BEGIN
  SELECT ws.phone_number, ws.voice_session_id, ws.flow_turn_count, ws.flow_timeout_kind, vcs.conversation_state
  INTO v_phone, v_vs_id, v_turn_count, v_kind, v_state
  FROM public.whatsapp_sessions ws
  JOIN public.voice_call_sessions vcs ON vcs.id = ws.voice_session_id
  WHERE ws.flow_timeout_at IS NOT NULL
    AND ws.flow_timeout_at <= now()
    -- Ensure no pending or processing user message exists for this customer
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_message_events wme
      WHERE wme.phone_number = ws.phone_number
        AND wme.processing_status IN ('pending', 'processing')
    )
  ORDER BY ws.flow_timeout_at ASC
  FOR UPDATE OF ws SKIP LOCKED
  LIMIT 1;

  IF v_phone IS NULL THEN
    RETURN;
  END IF;

  -- Verify expected turnCount: if turnCount changed, user replied earlier; drop timeout
  IF (v_state->>'turnCount')::INTEGER IS DISTINCT FROM v_turn_count THEN
    UPDATE public.whatsapp_sessions
    SET flow_timeout_at = NULL,
        flow_turn_count = NULL,
        flow_timeout_kind = NULL,
        updated_at = now()
    WHERE whatsapp_sessions.phone_number = v_phone;
    RETURN;
  END IF;

  -- Build timeout reply text in user's established language
  v_lang := COALESCE(v_state->>'currentLanguage', 'en');
  IF v_lang = 'hi' THEN
    v_reply := 'ऐसा लगता है कि आप कुछ समय से दूर हैं।

चीजों को सरल रखने के लिए, मैंने आपको मुख्य मेन्यू पर वापस ला दिया है।

Please choose an option:
1 → Products
2 → Benefits
3 → Policies
4 → Contact/Support';
  ELSIF v_lang = 'gu' THEN
    v_reply := 'એવું લાગે છે કે તમે થોડા સમય માટે દૂર છો.

સરળતા ખાતર, હું તમને મુખ્ય મેનુ પર પાછો લાવ્યો છું.

Please choose an option:
1 → Products
2 → Benefits
3 → Policies
4 → Contact/Support';
  ELSE
    v_reply := 'It looks like you''ve been away for a while.

To keep things simple, I''ve returned you to the main menu.

Please choose an option:
1 → Products
2 → Benefits
3 → Policies
4 → Contact/Support';
  END IF;

  -- Reset transient state while preserving cart, currentLanguage, languageEstablished
  v_new_state := (v_state - 'whatsAppProductContext' - 'awaitingCartRemoval' - 'activeCheckoutReview');
  v_new_state := jsonb_set(v_new_state, '{checkoutFields}', '{}'::jsonb);
  v_new_state := jsonb_set(v_new_state, '{turnCount}', to_jsonb(COALESCE((v_state->>'turnCount')::integer, 0) + 1));
  v_messages := COALESCE(v_state->'messages', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('role', 'assistant', 'content', v_reply)
  );
  v_new_state := jsonb_set(v_new_state, '{messages}', v_messages);

  -- Update session state in voice_call_sessions
  UPDATE public.voice_call_sessions
  SET conversation_state = v_new_state,
      updated_at = now()
  WHERE id = v_vs_id;

  -- Clear timeout metadata on whatsapp_sessions
  UPDATE public.whatsapp_sessions
  SET flow_timeout_at = NULL,
      flow_turn_count = NULL,
      flow_timeout_kind = NULL,
      updated_at = now()
  WHERE whatsapp_sessions.phone_number = v_phone;

  -- Create claimed outbound timeout message event (processing, attempt 1)
  INSERT INTO public.whatsapp_message_events (
    provider_message_id,
    phone_number,
    message_text,
    message_kind,
    reply_text,
    processing_status,
    attempt_count,
    next_attempt_at,
    created_at,
    updated_at
  ) VALUES (
    'timeout:' || v_phone || ':' || v_turn_count,
    v_phone,
    'Inactivity timeout',
    'timeout',
    v_reply,
    'processing',
    1,
    now(),
    now(),
    now()
  )
  ON CONFLICT (provider_message_id) DO UPDATE
    SET reply_text = EXCLUDED.reply_text,
        updated_at = now()
  RETURNING id INTO v_event_id;

  RETURN QUERY SELECT v_event_id, v_phone, v_vs_id, v_turn_count, v_kind, v_reply;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_expired_whatsapp_flow_timeout() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_expired_whatsapp_flow_timeout() TO service_role;

COMMIT;
