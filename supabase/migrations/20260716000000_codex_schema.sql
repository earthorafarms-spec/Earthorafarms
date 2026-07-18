-- =============================================================================
-- Migration: Codex Developer Portal Schema and RLS
-- =============================================================================

-- 1. Create codex logs table for developer metrics
CREATE TABLE IF NOT EXISTS codex_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('click', 'pipeline', 'api_health', 'error')),
  event_name VARCHAR(150) NOT NULL,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed initial codex access password
INSERT INTO admin_settings (key, value)
VALUES ('codex_password', 'coder')
ON CONFLICT (key) DO NOTHING;

-- 2. Create custom header verification function
CREATE OR REPLACE FUNCTION verify_codex_header()
RETURNS BOOLEAN SECURITY DEFINER LANGUAGE plpgsql AS $$
DECLARE
  passed_pwd TEXT;
  actual_pwd TEXT;
BEGIN
  passed_pwd := coalesce(current_setting('request.headers', true)::json->>'x-codex-password', '');
  IF passed_pwd = '' THEN
    RETURN FALSE;
  END IF;

  SELECT value INTO actual_pwd FROM admin_settings WHERE key = 'codex_password';
  RETURN passed_pwd = actual_pwd;
END;
$$;

-- 3. Enable RLS and setup policies
ALTER TABLE codex_logs ENABLE ROW LEVEL SECURITY;

-- Anyone can insert logs (so we can log errors/clicks from any visitor anonymously)
CREATE POLICY "Public insert codex logs" ON codex_logs
  FOR INSERT WITH CHECK (true);

-- Only clients with valid codex header can read logs
CREATE POLICY "Codex read logs" ON codex_logs
  FOR SELECT USING (verify_codex_header());

CREATE POLICY "Codex delete logs" ON codex_logs
  FOR DELETE USING (verify_codex_header());
