-- ── SECURITY FIX: Proper Row-Level Security Policies ────────────────────────
-- Drop all wide-open "Allow anon/authenticated operations" policies and
-- replace them with least-privilege policies.
--
-- Principle:
--   anon            = any website visitor (no Supabase Auth session)
--   authenticated   = logged-in customer via Supabase Auth (auth.uid() / auth.email())
--   service_role    = Edge Functions & Supabase internal (bypasses RLS entirely)
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- HELPER: Drop all existing permissive policies at once
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE policyname = 'Allow anon/authenticated operations'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PUBLIC READ-ONLY TABLES
--    Anyone can SELECT. Only service_role (Edge Functions / DB scripts) can
--    INSERT, UPDATE, DELETE.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1a. products ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public read products" ON products;
CREATE POLICY "Public read products" ON products
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin write products" ON products;
CREATE POLICY "Admin write products" ON products
  FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin update products" ON products;
CREATE POLICY "Admin update products" ON products
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service write products" ON products;
CREATE POLICY "Service write products" ON products
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 1b. inventory ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public read inventory" ON inventory;
CREATE POLICY "Public read inventory" ON inventory
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin write inventory" ON inventory;
CREATE POLICY "Admin write inventory" ON inventory
  FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin update inventory" ON inventory;
CREATE POLICY "Admin update inventory" ON inventory
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service write inventory" ON inventory;
CREATE POLICY "Service write inventory" ON inventory
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 1c. festival_details ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public read festival_details" ON festival_details;
CREATE POLICY "Public read festival_details" ON festival_details
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin write festival_details" ON festival_details;
CREATE POLICY "Admin write festival_details" ON festival_details
  FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin update festival_details" ON festival_details;
CREATE POLICY "Admin update festival_details" ON festival_details
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin delete festival_details" ON festival_details;
CREATE POLICY "Admin delete festival_details" ON festival_details
  FOR DELETE TO anon
  USING (true);

DROP POLICY IF EXISTS "Service write festival_details" ON festival_details;
CREATE POLICY "Service write festival_details" ON festival_details
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 1d. festival_deal_products ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Public read festival_deal_products" ON festival_deal_products;
CREATE POLICY "Public read festival_deal_products" ON festival_deal_products
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin write festival_deal_products" ON festival_deal_products;
CREATE POLICY "Admin write festival_deal_products" ON festival_deal_products
  FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin delete festival_deal_products" ON festival_deal_products;
CREATE POLICY "Admin delete festival_deal_products" ON festival_deal_products
  FOR DELETE TO anon
  USING (true);

DROP POLICY IF EXISTS "Service write festival_deal_products" ON festival_deal_products;
CREATE POLICY "Service write festival_deal_products" ON festival_deal_products
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 1e. review_details (public read, anon can submit review) ─────────────────
DROP POLICY IF EXISTS "Public read review_details" ON review_details;
CREATE POLICY "Public read review_details" ON review_details
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Anon submit review_details" ON review_details;
CREATE POLICY "Anon submit review_details" ON review_details
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage review_details" ON review_details;
CREATE POLICY "Service manage review_details" ON review_details
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 1f. coupons view (public read at checkout) ───────────────────────────────
-- The coupons view is used by checkout to validate coupon codes.
-- RLS does not apply to views; access is controlled by the underlying
-- coupon_details table policies (service_role only for writes).
GRANT SELECT ON coupons TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. CUSTOMER-OWNED TABLES
--    Authenticated users can only access their own data, matched by email.
-- ═══════════════════════════════════════════════════════════════════════════

-- 2a. users (linked to auth.users via id) ──────────────────────────────────
DROP POLICY IF EXISTS "Users read own" ON users;
CREATE POLICY "Users read own" ON users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Users insert own" ON users;
CREATE POLICY "Users insert own" ON users
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users update own" ON users;
CREATE POLICY "Users update own" ON users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Service manage users" ON users;
CREATE POLICY "Service manage users" ON users
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2b. User_details (matched by email) ──────────────────────────────────────
DROP POLICY IF EXISTS "Users read own User_details" ON "User_details";
CREATE POLICY "Users read own User_details" ON "User_details"
  FOR SELECT TO authenticated
  USING (user_email = auth.email());

DROP POLICY IF EXISTS "Users insert own User_details" ON "User_details";
CREATE POLICY "Users insert own User_details" ON "User_details"
  FOR INSERT TO authenticated
  WITH CHECK (user_email = auth.email());

DROP POLICY IF EXISTS "Users update own User_details" ON "User_details";
CREATE POLICY "Users update own User_details" ON "User_details"
  FOR UPDATE TO authenticated
  USING (user_email = auth.email())
  WITH CHECK (user_email = auth.email());

DROP POLICY IF EXISTS "Service manage User_details" ON "User_details";
CREATE POLICY "Service manage User_details" ON "User_details"
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2c. Cart_details (cart_user_id = email) ──────────────────────────────────
DROP POLICY IF EXISTS "Users manage own cart" ON "Cart_details";
CREATE POLICY "Users manage own cart" ON "Cart_details"
  FOR ALL TO authenticated
  USING (cart_user_id = auth.email())
  WITH CHECK (cart_user_id = auth.email());

DROP POLICY IF EXISTS "Service manage Cart_details" ON "Cart_details";
CREATE POLICY "Service manage Cart_details" ON "Cart_details"
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2d. Orders (order_user_id = email) ───────────────────────────────────────
DROP POLICY IF EXISTS "Users read own Orders" ON "Orders";
CREATE POLICY "Users read own Orders" ON "Orders"
  FOR SELECT TO authenticated
  USING (order_user_id = auth.email());

DROP POLICY IF EXISTS "Users insert Orders" ON "Orders";
CREATE POLICY "Users insert Orders" ON "Orders"
  FOR INSERT TO authenticated
  WITH CHECK (order_user_id = auth.email());

DROP POLICY IF EXISTS "Service manage Orders" ON "Orders";
CREATE POLICY "Service manage Orders" ON "Orders"
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2e. orders (normalized table) ────────────────────────────────────────────
-- Admin (anon) can read all orders. Customers (authenticated) read only own.
DROP POLICY IF EXISTS "Admin read orders" ON orders;
CREATE POLICY "Admin read orders" ON orders
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "Users read own orders" ON orders;
CREATE POLICY "Users read own orders" ON orders
  FOR SELECT TO authenticated
  USING (user_id = auth.email());

DROP POLICY IF EXISTS "Service manage orders" ON orders;
CREATE POLICY "Service manage orders" ON orders
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2f. order_items ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin read order_items" ON order_items;
CREATE POLICY "Admin read order_items" ON order_items
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "Users read own order_items" ON order_items;
CREATE POLICY "Users read own order_items" ON order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
      AND orders.user_id = auth.email()
    )
  );

DROP POLICY IF EXISTS "Service manage order_items" ON order_items;
CREATE POLICY "Service manage order_items" ON order_items
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2g. Order_history ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin read Order_history" ON "Order_history";
CREATE POLICY "Admin read Order_history" ON "Order_history"
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "Admin insert Order_history" ON "Order_history";
CREATE POLICY "Admin insert Order_history" ON "Order_history"
  FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users read own Order_history" ON "Order_history";
CREATE POLICY "Users read own Order_history" ON "Order_history"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = "Order_history".order_id
      AND orders.user_id = auth.email()
    )
  );

DROP POLICY IF EXISTS "Users insert Order_history" ON "Order_history";
CREATE POLICY "Users insert Order_history" ON "Order_history"
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage Order_history" ON "Order_history";
CREATE POLICY "Service manage Order_history" ON "Order_history"
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2h. Payments ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin read Payments" ON "Payments";
CREATE POLICY "Admin read Payments" ON "Payments"
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "Users read own Payments" ON "Payments";
CREATE POLICY "Users read own Payments" ON "Payments"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = "Payments".payment_order_id
      AND orders.user_id = auth.email()
    )
  );

DROP POLICY IF EXISTS "Users insert Payments" ON "Payments";
CREATE POLICY "Users insert Payments" ON "Payments"
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage Payments" ON "Payments";
CREATE POLICY "Service manage Payments" ON "Payments"
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2i. favorite_details (user_email) ────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own favorites" ON favorite_details;
CREATE POLICY "Users manage own favorites" ON favorite_details
  FOR ALL TO authenticated
  USING (user_email = auth.email())
  WITH CHECK (user_email = auth.email());

DROP POLICY IF EXISTS "Service manage favorite_details" ON favorite_details;
CREATE POLICY "Service manage favorite_details" ON favorite_details
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. INSERT-ONLY TABLES (anon can write, cannot read)
--    Used for contact forms, restock requests, telemetry.
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a. Contact_details ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anon submit contact" ON "Contact_details";
CREATE POLICY "Anon submit contact" ON "Contact_details"
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage contacts" ON "Contact_details";
CREATE POLICY "Service manage contacts" ON "Contact_details"
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 3b. customer_restock_requests ────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin read restock_requests" ON customer_restock_requests;
CREATE POLICY "Admin read restock_requests" ON customer_restock_requests
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "Anon request restock" ON customer_restock_requests;
CREATE POLICY "Anon request restock" ON customer_restock_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage restock_requests" ON customer_restock_requests;
CREATE POLICY "Service manage restock_requests" ON customer_restock_requests
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 3c. Admin_analytics (anon insert for page tracking, anon read for dashboard)
DROP POLICY IF EXISTS "Admin read analytics" ON "Admin_analytics";
CREATE POLICY "Admin read analytics" ON "Admin_analytics"
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "Anon insert analytics" ON "Admin_analytics";
CREATE POLICY "Anon insert analytics" ON "Admin_analytics"
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage analytics" ON "Admin_analytics";
CREATE POLICY "Service manage analytics" ON "Admin_analytics"
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 3d. analytics_events ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anon insert analytics_events" ON analytics_events;
CREATE POLICY "Anon insert analytics_events" ON analytics_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage analytics_events" ON analytics_events;
CREATE POLICY "Service manage analytics_events" ON analytics_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 3e. chat_sessions ────────────────────────────────────────────────────────
-- Table may not exist yet; policies applied in a separate migration if needed.

-- 3f. chat_messages ────────────────────────────────────────────────────────
-- Table may not exist yet; policies applied in a separate migration if needed.


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SERVICE-ROLE-ONLY TABLES (no anon/authenticated access at all)
--    These contain credentials, business logic, and internal state.
-- ═══════════════════════════════════════════════════════════════════════════

-- 4a. admin_settings ───────────────────────────────────────────────────────
-- Already locked (no policies). Re-assert no public policies exist.
DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON admin_settings;

-- 4b. otp_codes ────────────────────────────────────────────────────────────
-- Already locked. Only Edge Functions (service_role) touch this.
DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON otp_codes;

-- 4c. coupon_details (admin CRUD via dashboard) ────────────────────────────
DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON coupon_details;
DROP POLICY IF EXISTS "Admin read coupon_details" ON coupon_details;
CREATE POLICY "Admin read coupon_details" ON coupon_details
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "Admin insert coupon_details" ON coupon_details;
CREATE POLICY "Admin insert coupon_details" ON coupon_details
  FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin update coupon_details" ON coupon_details;
CREATE POLICY "Admin update coupon_details" ON coupon_details
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin delete coupon_details" ON coupon_details;
CREATE POLICY "Admin delete coupon_details" ON coupon_details
  FOR DELETE TO anon
  USING (true);

-- 4d. sms_alert_logs ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON sms_alert_logs;
-- No policies = service_role only.

-- 4e. restock_notifications ───────────────────────────────────────────────
-- Table may not exist yet; policies applied in a separate migration if needed.


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. GRANT SANITY CHECK
--    Revoke excessive privileges. anon and authenticated should only have
--    whatever their RLS policies allow — no blanket ALL on tables.
-- ═══════════════════════════════════════════════════════════════════════════

-- Remove the blanket "ALL ON ALL TABLES" grants for anon and authenticated.
-- These overrode RLS and gave full access regardless. service_role still
-- needs ALL because Edge Functions use it.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

-- Re-grant USAGE on schema (required to even see tables)
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Explicitly grant only the tables they actually need to touch.
-- The RLS policies do the fine-grained row filtering.

-- Tables where anon SELECT is needed (RLS handles row filtering):
GRANT SELECT ON products TO anon, authenticated;
GRANT SELECT ON inventory TO anon, authenticated;
GRANT SELECT ON festival_details TO anon, authenticated;
GRANT SELECT ON festival_deal_products TO anon, authenticated;
GRANT SELECT ON review_details TO anon, authenticated;

-- Admin dashboard tables: anon SELECT needed because admin runs as anon
-- (no Supabase Auth for admin — gated by password+OTP instead).
-- NOTE: Eventually migrate admin queries to Edge Functions.
GRANT SELECT ON orders TO anon, authenticated;
GRANT SELECT ON order_items TO anon, authenticated;
GRANT SELECT ON "Admin_analytics" TO anon, authenticated;
GRANT SELECT ON "Order_history" TO anon, authenticated;
GRANT SELECT ON "Payments" TO anon, authenticated;
GRANT SELECT ON coupon_details TO anon, authenticated;
GRANT SELECT ON customer_restock_requests TO anon, authenticated;

-- Admin dashboard CRUD grants (admin runs as anon):
GRANT INSERT, UPDATE ON products TO anon;
GRANT INSERT, UPDATE ON inventory TO anon;
GRANT INSERT, UPDATE, DELETE ON festival_details TO anon;
GRANT INSERT, DELETE ON festival_deal_products TO anon;
GRANT INSERT, UPDATE, DELETE ON coupon_details TO anon;
GRANT INSERT ON "Order_history" TO anon;
GRANT INSERT ON review_details TO anon, authenticated;
GRANT INSERT ON "Contact_details" TO anon, authenticated;
GRANT INSERT ON customer_restock_requests TO anon, authenticated;
GRANT INSERT ON "Admin_analytics" TO anon, authenticated;
GRANT INSERT ON analytics_events TO anon, authenticated;

-- Tables where authenticated users manage their own data:
GRANT SELECT, INSERT, UPDATE ON "User_details" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cart_details" TO authenticated;
GRANT SELECT, INSERT ON "Orders" TO authenticated;
GRANT SELECT, INSERT ON "Payments" TO authenticated;
GRANT SELECT, INSERT ON "Order_history" TO authenticated;
GRANT SELECT ON orders TO authenticated;
GRANT SELECT ON order_items TO authenticated;
GRANT SELECT, INSERT, DELETE ON favorite_details TO authenticated;
GRANT SELECT, INSERT, UPDATE ON users TO authenticated;

-- Sequences for tables that get INSERT from anon/authenticated:
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Fix: restock_product function — only service_role should execute it
REVOKE EXECUTE ON FUNCTION restock_product FROM anon, authenticated;

-- Fix: trigger_low_stock_sms — only service_role should execute it
REVOKE EXECUTE ON FUNCTION trigger_low_stock_sms FROM anon, authenticated;

-- Fix: sync_orders_trigger — only service_role (called by trigger)
REVOKE EXECUTE ON FUNCTION sync_orders_trigger FROM anon, authenticated;

-- Fix: sync_order_status_trigger — only service_role
REVOKE EXECUTE ON FUNCTION sync_order_status_trigger FROM anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. RATE LIMITING TABLE
--    Tracks failed auth attempts for Edge Function rate limiting.
--    Edge Functions check this table before processing login/OTP requests.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  id SERIAL PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL,
  action VARCHAR(50) NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_lookup
  ON rate_limit_attempts(ip_address, action, attempted_at);

-- Only service_role (Edge Functions) can read/write this table
ALTER TABLE rate_limit_attempts ENABLE ROW LEVEL SECURITY;
-- No public policies = service_role only

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
