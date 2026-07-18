-- =============================================================================
-- Migration: Admin Settings table (password storage, future settings)
-- =============================================================================

CREATE TABLE IF NOT EXISTS admin_settings (
  key   VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default row with the env var value — the edge function will use this
-- if the env var is unset or fall back to env var if no row exists.

ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

-- Allow anon / service role to read and write (admin panel uses anon key)
CREATE POLICY "Anon can manage admin_settings"
  ON admin_settings FOR ALL
  USING (true)
  WITH CHECK (true);
