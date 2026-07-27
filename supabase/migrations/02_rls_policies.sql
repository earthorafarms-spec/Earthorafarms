-- ═══════════════════════════════════════════════════════════════════════════
-- EARTHORA FARMS — CONSOLIDATED RLS POLICIES & SECURITY GRANTS
-- File: 02_rls_policies.sql
-- Description: Complete Row-Level Security (RLS) policies, permissions, role grants, and storage bucket security.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. ENABLE RLS ON ALL TABLES ───────────────────────────────────────────────
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cart_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Admin_analytics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_deal_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_restock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorite_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_alert_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_attempts ENABLE ROW LEVEL SECURITY;

-- ── 2. DROP PERMISSIVE / LEGACY POLICIES ──────────────────────────────────────
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

-- ── 3. PUBLIC READ TABLES (products, inventory, festival_details, reviews) ───

-- 3a. products
DROP POLICY IF EXISTS "Public read products" ON products;
CREATE POLICY "Public read products" ON products FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admin write products" ON products;
CREATE POLICY "Admin write products" ON products FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Admin update products" ON products;
CREATE POLICY "Admin update products" ON products FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin delete products" ON products;
CREATE POLICY "Admin delete products" ON products FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Service write products" ON products;
CREATE POLICY "Service write products" ON products FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3b. inventory
DROP POLICY IF EXISTS "Public read inventory" ON inventory;
CREATE POLICY "Public read inventory" ON inventory FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admin write inventory" ON inventory;
CREATE POLICY "Admin write inventory" ON inventory FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Admin update inventory" ON inventory;
CREATE POLICY "Admin update inventory" ON inventory FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin delete inventory" ON inventory;
CREATE POLICY "Admin delete inventory" ON inventory FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Service write inventory" ON inventory;
CREATE POLICY "Service write inventory" ON inventory FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3c. festival_details
DROP POLICY IF EXISTS "Public read festival_details" ON festival_details;
CREATE POLICY "Public read festival_details" ON festival_details FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admin write festival_details" ON festival_details;
CREATE POLICY "Admin write festival_details" ON festival_details FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Admin update festival_details" ON festival_details;
CREATE POLICY "Admin update festival_details" ON festival_details FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin delete festival_details" ON festival_details;
CREATE POLICY "Admin delete festival_details" ON festival_details FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS "Service write festival_details" ON festival_details;
CREATE POLICY "Service write festival_details" ON festival_details FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3d. festival_deal_products
DROP POLICY IF EXISTS "Public read festival_deal_products" ON festival_deal_products;
CREATE POLICY "Public read festival_deal_products" ON festival_deal_products FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admin write festival_deal_products" ON festival_deal_products;
CREATE POLICY "Admin write festival_deal_products" ON festival_deal_products FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Admin delete festival_deal_products" ON festival_deal_products;
CREATE POLICY "Admin delete festival_deal_products" ON festival_deal_products FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS "Service write festival_deal_products" ON festival_deal_products;
CREATE POLICY "Service write festival_deal_products" ON festival_deal_products FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3e. review_details
DROP POLICY IF EXISTS "Public read review_details" ON review_details;
CREATE POLICY "Public read review_details" ON review_details FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Anon submit review_details" ON review_details;
CREATE POLICY "Anon submit review_details" ON review_details FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage review_details" ON review_details;
CREATE POLICY "Service manage review_details" ON review_details FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 4. CUSTOMER-OWNED DATA POLICIES ──────────────────────────────────────────

-- 4a. users
DROP POLICY IF EXISTS "Users read own" ON users;
CREATE POLICY "Users read own" ON users FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "Users insert own" ON users;
CREATE POLICY "Users insert own" ON users FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users update own" ON users;
CREATE POLICY "Users update own" ON users FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Service manage users" ON users;
CREATE POLICY "Service manage users" ON users FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4b. User_details
DROP POLICY IF EXISTS "Users read own User_details" ON "User_details";
CREATE POLICY "Users read own User_details" ON "User_details" FOR SELECT TO authenticated USING (user_email = auth.email());

DROP POLICY IF EXISTS "Anyone can insert User_details" ON "User_details";
CREATE POLICY "Anyone can insert User_details" ON "User_details" FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Users insert own User_details" ON "User_details";
CREATE POLICY "Users insert own User_details" ON "User_details" FOR INSERT TO authenticated WITH CHECK (user_email = auth.email());

DROP POLICY IF EXISTS "Users update own User_details" ON "User_details";
CREATE POLICY "Users update own User_details" ON "User_details" FOR UPDATE TO authenticated USING (user_email = auth.email()) WITH CHECK (user_email = auth.email());

DROP POLICY IF EXISTS "Service manage User_details" ON "User_details";
CREATE POLICY "Service manage User_details" ON "User_details" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4c. Cart_details
DROP POLICY IF EXISTS "Users manage own cart" ON "Cart_details";
CREATE POLICY "Users manage own cart" ON "Cart_details" FOR ALL TO authenticated USING (cart_user_id = auth.email()) WITH CHECK (cart_user_id = auth.email());

DROP POLICY IF EXISTS "Service manage Cart_details" ON "Cart_details";
CREATE POLICY "Service manage Cart_details" ON "Cart_details" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4d. Orders (includes auth.jwt() fallback for Razorpay checkout)
DROP POLICY IF EXISTS "Users read own Orders" ON "Orders";
CREATE POLICY "Users read own Orders" ON "Orders" FOR SELECT TO authenticated USING (order_user_id = auth.email() OR order_user_id = (auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Users insert Orders" ON "Orders";
CREATE POLICY "Users insert Orders" ON "Orders" FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage Orders" ON "Orders";
CREATE POLICY "Service manage Orders" ON "Orders" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4e. orders
DROP POLICY IF EXISTS "Admin read orders" ON orders;
CREATE POLICY "Admin read orders" ON orders FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Users read own orders" ON orders;
CREATE POLICY "Users read own orders" ON orders FOR SELECT TO authenticated USING (user_id = auth.email() OR user_id = (auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Service manage orders" ON orders;
CREATE POLICY "Service manage orders" ON orders FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4f. order_items
DROP POLICY IF EXISTS "Admin read order_items" ON order_items;
CREATE POLICY "Admin read order_items" ON order_items FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Users read own order_items" ON order_items;
CREATE POLICY "Users read own order_items" ON order_items FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = order_items.order_id
    AND (orders.user_id = auth.email() OR orders.user_id = (auth.jwt() ->> 'email'))
  )
);

DROP POLICY IF EXISTS "Service manage order_items" ON order_items;
CREATE POLICY "Service manage order_items" ON order_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4g. Order_history
DROP POLICY IF EXISTS "Admin read Order_history" ON "Order_history";
CREATE POLICY "Admin read Order_history" ON "Order_history" FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Admin insert Order_history" ON "Order_history";
CREATE POLICY "Admin insert Order_history" ON "Order_history" FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Users read own Order_history" ON "Order_history";
CREATE POLICY "Users read own Order_history" ON "Order_history" FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = "Order_history".order_id
    AND (orders.user_id = auth.email() OR orders.user_id = (auth.jwt() ->> 'email'))
  )
);

DROP POLICY IF EXISTS "Users insert Order_history" ON "Order_history";
CREATE POLICY "Users insert Order_history" ON "Order_history" FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage Order_history" ON "Order_history";
CREATE POLICY "Service manage Order_history" ON "Order_history" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4h. Payments
DROP POLICY IF EXISTS "Admin read Payments" ON "Payments";
CREATE POLICY "Admin read Payments" ON "Payments" FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Users read own Payments" ON "Payments";
CREATE POLICY "Users read own Payments" ON "Payments" FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = "Payments".payment_order_id
    AND (orders.user_id = auth.email() OR orders.user_id = (auth.jwt() ->> 'email'))
  )
);

DROP POLICY IF EXISTS "Users insert Payments" ON "Payments";
CREATE POLICY "Users insert Payments" ON "Payments" FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage Payments" ON "Payments";
CREATE POLICY "Service manage Payments" ON "Payments" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4i. favorite_details
DROP POLICY IF EXISTS "Users manage own favorites" ON favorite_details;
CREATE POLICY "Users manage own favorites" ON favorite_details FOR ALL TO authenticated USING (user_email = auth.email()) WITH CHECK (user_email = auth.email());

DROP POLICY IF EXISTS "Service manage favorite_details" ON favorite_details;
CREATE POLICY "Service manage favorite_details" ON favorite_details FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 5. FORM SUBMISSION & ANALYTICS POLICIES ───────────────────────────────────

-- 5a. Contact_details
DROP POLICY IF EXISTS "Anon submit contact" ON "Contact_details";
CREATE POLICY "Anon submit contact" ON "Contact_details" FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage contacts" ON "Contact_details";
CREATE POLICY "Service manage contacts" ON "Contact_details" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5b. customer_restock_requests
DROP POLICY IF EXISTS "Admin read restock_requests" ON customer_restock_requests;
CREATE POLICY "Admin read restock_requests" ON customer_restock_requests FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon request restock" ON customer_restock_requests;
CREATE POLICY "Anon request restock" ON customer_restock_requests FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage restock_requests" ON customer_restock_requests;
CREATE POLICY "Service manage restock_requests" ON customer_restock_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5c. Admin_analytics
DROP POLICY IF EXISTS "Admin read analytics" ON "Admin_analytics";
CREATE POLICY "Admin read analytics" ON "Admin_analytics" FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon insert analytics" ON "Admin_analytics";
CREATE POLICY "Anon insert analytics" ON "Admin_analytics" FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage analytics" ON "Admin_analytics";
CREATE POLICY "Service manage analytics" ON "Admin_analytics" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5d. analytics_events
DROP POLICY IF EXISTS "Anon insert analytics_events" ON analytics_events;
CREATE POLICY "Anon insert analytics_events" ON analytics_events FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage analytics_events" ON analytics_events;
CREATE POLICY "Service manage analytics_events" ON analytics_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 6. ADMIN & SYSTEM INTERNAL TABLES POLICIES ────────────────────────────────

-- 6a. coupon_details
DROP POLICY IF EXISTS "Admin read coupon_details" ON coupon_details;
CREATE POLICY "Admin read coupon_details" ON coupon_details FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Admin insert coupon_details" ON coupon_details;
CREATE POLICY "Admin insert coupon_details" ON coupon_details FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Admin update coupon_details" ON coupon_details;
CREATE POLICY "Admin update coupon_details" ON coupon_details FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin delete coupon_details" ON coupon_details;
CREATE POLICY "Admin delete coupon_details" ON coupon_details FOR DELETE TO anon USING (true);

-- 6b. sms_alert_logs
DROP POLICY IF EXISTS "Admin read sms_alert_logs" ON sms_alert_logs;
CREATE POLICY "Admin read sms_alert_logs" ON sms_alert_logs FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Service manage sms_alert_logs" ON sms_alert_logs;
CREATE POLICY "Service manage sms_alert_logs" ON sms_alert_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 7. STORAGE POLICIES ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public read product images" ON storage.objects;
CREATE POLICY "Public read product images" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Anon/auth upload product images" ON storage.objects;
CREATE POLICY "Anon/auth upload product images" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Anon/auth update product images" ON storage.objects;
CREATE POLICY "Anon/auth update product images" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'product-images');

-- ── 8. ROLE PERMISSIONS & GRANTS ──────────────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- SELECT Grants
GRANT SELECT ON products TO anon, authenticated;
GRANT SELECT ON inventory TO anon, authenticated;
GRANT SELECT ON festival_details TO anon, authenticated;
GRANT SELECT ON festival_deal_products TO anon, authenticated;
GRANT SELECT ON review_details TO anon, authenticated;
GRANT SELECT ON coupons TO anon, authenticated;
GRANT SELECT ON orders TO anon, authenticated;
GRANT SELECT ON order_items TO anon, authenticated;
GRANT SELECT ON "Admin_analytics" TO anon, authenticated;
GRANT SELECT ON "Order_history" TO anon, authenticated;
GRANT SELECT ON "Payments" TO anon, authenticated;
GRANT SELECT ON coupon_details TO anon, authenticated;
GRANT SELECT ON customer_restock_requests TO anon, authenticated;
GRANT SELECT ON sms_alert_logs TO anon, authenticated;

-- INSERT, UPDATE & DELETE Grants
GRANT INSERT, UPDATE, DELETE ON products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON inventory TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON festival_details TO anon;
GRANT INSERT, DELETE ON festival_deal_products TO anon;
GRANT INSERT, UPDATE, DELETE ON coupon_details TO anon;
GRANT INSERT ON "Order_history" TO anon;
GRANT INSERT ON review_details TO anon, authenticated;
GRANT INSERT ON "Contact_details" TO anon, authenticated;
GRANT INSERT ON customer_restock_requests TO anon, authenticated;
GRANT INSERT ON "Admin_analytics" TO anon, authenticated;
GRANT INSERT ON analytics_events TO anon, authenticated;

-- Customer Grants
GRANT INSERT ON "User_details" TO anon;
GRANT SELECT, INSERT, UPDATE ON "User_details" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cart_details" TO authenticated;
GRANT SELECT, INSERT ON "Orders" TO authenticated;
GRANT SELECT, INSERT ON "Payments" TO authenticated;
GRANT SELECT, INSERT ON "Order_history" TO authenticated;
GRANT SELECT ON orders TO authenticated;
GRANT SELECT ON order_items TO authenticated;
GRANT SELECT, INSERT, DELETE ON favorite_details TO authenticated;
GRANT SELECT, INSERT, UPDATE ON users TO authenticated;

-- Security Definer Functions Privileges
REVOKE EXECUTE ON FUNCTION restock_product FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION trigger_low_stock_sms FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION sync_orders_trigger FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION sync_order_status_trigger FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION restock_product TO service_role;
GRANT EXECUTE ON FUNCTION trigger_low_stock_sms TO service_role;
GRANT EXECUTE ON FUNCTION sync_orders_trigger TO service_role;
GRANT EXECUTE ON FUNCTION sync_order_status_trigger TO service_role;
