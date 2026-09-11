-- Keep the customer's initially established voice language with the review
-- session. It is intentionally immutable after creation: a phone call stays
-- in its first substantive language, and the form/invoice must match it.
ALTER TABLE public.voice_checkout_sessions
  ADD COLUMN IF NOT EXISTS conversation_language TEXT NOT NULL DEFAULT 'en'
  CHECK (conversation_language IN ('en', 'hi', 'gu'));

