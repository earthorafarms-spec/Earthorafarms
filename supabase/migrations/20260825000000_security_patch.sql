-- =========================================================================
-- SECURITY PATCH — 2026-08-25
-- Apply this to the existing running database in the Supabase SQL editor.
-- Run schema_website.sql from scratch on a fresh database instead.
-- =========================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- C-04: Widen otp_codes.otp column for SHA-256 hash storage (64 hex chars)
-- After this migration the send-otp function stores a SHA-256 hash of the
-- OTP instead of the plaintext digit string.
-- NOTE: Existing OTP rows in this table will be invalid after this change.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE otp_codes ALTER COLUMN otp TYPE VARCHAR(64);

-- Flush all existing (now-stale plaintext) OTPs
DELETE FROM otp_codes;


-- ─────────────────────────────────────────────────────────────────────────
-- H-01: Enable Row Level Security on tables that were missing it
-- ─────────────────────────────────────────────────────────────────────────

-- kacc_users — previously had GRANT INSERT/UPDATE/DELETE for anon, no RLS.
-- Now: only service_role can write; anon/authenticated can only SELECT.
-- IMPACT: Admin portal KACC user management (add/edit/delete users) that
-- calls Supabase directly with the anon key will stop working. Those
-- operations must be routed through a service-role Edge Function.
ALTER TABLE kacc_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service manage kacc_users" ON kacc_users;
CREATE POLICY "Service manage kacc_users"
  ON kacc_users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin read kacc_users" ON kacc_users;
CREATE POLICY "Admin read kacc_users"
  ON kacc_users FOR SELECT
  TO anon, authenticated
  USING (true);

-- admin_settings — previously had no RLS.
-- anon can SELECT (admin portal reads settings) and UPDATE existing rows
-- (Settings page updates password/phone via direct Supabase call).
-- INSERT and DELETE are blocked — prevents adding/removing rows via anon.
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service manage admin_settings" ON admin_settings;
CREATE POLICY "Service manage admin_settings"
  ON admin_settings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin read admin_settings" ON admin_settings;
CREATE POLICY "Admin read admin_settings"
  ON admin_settings FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Admin update admin_settings" ON admin_settings;
CREATE POLICY "Admin update admin_settings"
  ON admin_settings FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────
-- C-01: Fix orders / order_items RLS — remove blanket anon FOR ALL
-- The old "Admin manage orders FOR ALL TO anon" allowed any anonymous
-- internet user to UPDATE or DELETE any customer order.
-- ─────────────────────────────────────────────────────────────────────────

-- orders
DROP POLICY IF EXISTS "Admin manage orders" ON orders;

-- Guest checkout still needs to INSERT orders as anon
DROP POLICY IF EXISTS "Anon checkout insert orders" ON orders;
CREATE POLICY "Anon checkout insert orders"
  ON orders FOR INSERT
  TO anon
  WITH CHECK (true);

-- Authenticated users can also INSERT (logged-in checkout)
DROP POLICY IF EXISTS "Auth checkout insert orders" ON orders;
CREATE POLICY "Auth checkout insert orders"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- service_role can do everything (Edge Functions, admin backend)
DROP POLICY IF EXISTS "Service manage orders" ON orders;
CREATE POLICY "Service manage orders"
  ON orders FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- NOTE: "Admin read orders" (SELECT TO anon) is kept to avoid breaking the
-- admin portal. Long-term it should move to a service-role proxy so
-- customer PII is not accessible via the public anon key.


-- order_items
DROP POLICY IF EXISTS "Admin manage order_items" ON order_items;

DROP POLICY IF EXISTS "Anon checkout insert order_items" ON order_items;
CREATE POLICY "Anon checkout insert order_items"
  ON order_items FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Auth checkout insert order_items" ON order_items;
CREATE POLICY "Auth checkout insert order_items"
  ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Admin portal needs to read order items
DROP POLICY IF EXISTS "Admin read order_items" ON order_items;
CREATE POLICY "Admin read order_items"
  ON order_items FOR SELECT
  TO anon
  USING (true);

-- Authenticated users can read their own order items
DROP POLICY IF EXISTS "Users read own order_items" ON order_items;
CREATE POLICY "Users read own order_items"
  ON order_items FOR SELECT
  TO authenticated
  USING (
    order_id IN (
      SELECT id FROM orders
      WHERE user_id = auth.email()
         OR user_id = (auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "Service manage order_items" ON order_items;
CREATE POLICY "Service manage order_items"
  ON order_items FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────
-- M-03: Restrict review submission to authenticated users only
-- Previously anon could submit reviews for any product.
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anon submit review_details" ON review_details;

DROP POLICY IF EXISTS "Authenticated submit review_details" ON review_details;
CREATE POLICY "Authenticated submit review_details"
  ON review_details FOR INSERT
  TO authenticated
  WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────
-- L-04 / M-03: Fix review_rating column type to enforce valid range
-- Converts VARCHAR(255) → NUMERIC(2,1) with a 1–5 CHECK constraint.
-- PREREQUISITE: all existing review_rating values must be valid numbers.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'review_details'
      AND column_name = 'review_rating'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE review_details
      ALTER COLUMN review_rating TYPE NUMERIC(2,1)
        USING review_rating::NUMERIC(2,1);

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'review_details'
        AND constraint_name = 'check_review_rating_range'
    ) THEN
      ALTER TABLE review_details
        ADD CONSTRAINT check_review_rating_range
          CHECK (review_rating BETWEEN 1 AND 5);
    END IF;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────
-- M-06: Prevent duplicate restock requests per product/phone combination
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE customer_restock_requests
  ADD CONSTRAINT IF NOT EXISTS unique_restock_per_product_phone
    UNIQUE (product_id, customer_phone);


-- ─────────────────────────────────────────────────────────────────────────
-- H-06: Automated cleanup of rate_limit_attempts (requires pg_cron)
-- Run the cron.schedule() call manually in the Supabase SQL editor after
-- enabling the pg_cron extension (Database → Extensions → pg_cron).
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT cron.schedule(
--   'cleanup-rate-limits',
--   '0 * * * *',
--   $$DELETE FROM rate_limit_attempts WHERE attempted_at < NOW() - INTERVAL '24 hours'$$
-- );
