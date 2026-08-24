-- ── WHATSAPP SESSIONS ────────────────────────────────────────────────────────
-- Adds WhatsApp as a channel alongside voice. Each WhatsApp phone number gets
-- one active session; when it expires the next message starts a fresh one.
--
-- Strategy: reuse voice_call_sessions for conversation state + FK chain to
-- voice_checkout_sessions. whatsapp_sessions is just a phone→session lookup.
-- ─────────────────────────────────────────────────────────────────────────────

-- Allow 'whatsapp' as a provider in voice_call_sessions.
ALTER TABLE voice_call_sessions DROP CONSTRAINT IF EXISTS voice_call_sessions_provider_check;
ALTER TABLE voice_call_sessions ADD CONSTRAINT voice_call_sessions_provider_check
  CHECK (provider IN ('browser', 'tata_smartflo', 'whatsapp'));

-- ── whatsapp_sessions ─────────────────────────────────────────────────────────
-- One row per WhatsApp phone number. voice_session_id links to the active
-- voice_call_sessions row that holds conversation_state and the FK needed
-- by voice_checkout_sessions. When a session expires (checked on next message)
-- the old voice_call_sessions row is abandoned and a new one is created.
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number     TEXT        NOT NULL UNIQUE,   -- E.164, e.g. +919876543210
  voice_session_id UUID        NOT NULL REFERENCES voice_call_sessions(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_phone ON whatsapp_sessions(phone_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_voice ON whatsapp_sessions(voice_session_id);

DROP TRIGGER IF EXISTS update_whatsapp_sessions_modtime ON whatsapp_sessions;
CREATE TRIGGER update_whatsapp_sessions_modtime
  BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION update_voice_updated_at_column();

-- RLS — service role only (same pattern as voice_call_sessions)
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service manage whatsapp_sessions" ON whatsapp_sessions;
CREATE POLICY "Service manage whatsapp_sessions"
  ON whatsapp_sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT ALL ON whatsapp_sessions TO service_role;
REVOKE ALL ON whatsapp_sessions FROM anon, authenticated;
