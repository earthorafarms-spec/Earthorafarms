-- ═══════════════════════════════════════════════════════════════════════════
-- EARTHORA FARMS — CONSOLIDATED DATABASE SCHEMA + RLS (SINGLE FILE)
-- File: 00_schema_consolidated.sql
-- Description: Everything in one migration — tables, views, triggers,
--              functions, storage buckets, RLS policies, and grants.
--              NO seed data (catalog is managed via the admin portal).
--              Voice agent (call_sessions, voice_orders, knowledge_base)
--              and chatbot (chat_sessions, chat_messages) schemas removed.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── GLOBAL TRIGGER FUNCTION ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   IF TG_TABLE_NAME = 'User_details' THEN
      NEW.user_updated_at = NOW();
   ELSIF TG_TABLE_NAME = 'Cart_details' THEN
      NEW.cart_updated_at = NOW();
   ELSIF TG_TABLE_NAME = 'Orders' THEN
      NEW.order_updated_at = NOW();
   ELSIF TG_TABLE_NAME = 'Payments' THEN
      NEW.payment_updated_at = NOW();
   ELSIF TG_TABLE_NAME = 'Order_history' THEN
      NEW.order_updated_at = NOW();
   ELSIF TG_TABLE_NAME = 'Admin_analytics' THEN
      NEW.visitor_updated_at = NOW();
   ELSIF TG_TABLE_NAME = 'products' THEN
      NEW.updated_at = NOW();
   ELSIF TG_TABLE_NAME = 'inventory' THEN
      NEW.updated_at = NOW();
   ELSIF TG_TABLE_NAME = 'coupon_details' THEN
      NEW.coupon_updated_at = NOW();
   ELSIF TG_TABLE_NAME = 'festival_details' THEN
      NEW.updated_at = NOW();
   ELSIF TG_TABLE_NAME = 'review_details' THEN
      NEW.review_updated_at = NOW();
   END IF;
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 1. PRODUCTS TABLE ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100) DEFAULT 'moringa',
  mrp NUMERIC(10,2) NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  tag VARCHAR(100),
  badge VARCHAR(50),
  hsn_code VARCHAR(50) DEFAULT '12119029',
  rating NUMERIC(3,2) DEFAULT 4.5,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  highlights TEXT[],
  images JSONB DEFAULT '[]',
  health_benefits TEXT[],
  usage_instructions TEXT,
  ingredients TEXT,
  certifications TEXT[],
  faqs JSONB DEFAULT '[]',
  seo JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS update_products_modtime ON products;
CREATE TRIGGER update_products_modtime
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. INVENTORY TABLE ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  total_stock INTEGER NOT NULL DEFAULT 0 CHECK (total_stock >= 0),
  reserved_stock INTEGER NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 15,
  alert_sent_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(product_id)
);

DROP TRIGGER IF EXISTS update_inventory_modtime ON inventory;
CREATE TRIGGER update_inventory_modtime
BEFORE UPDATE ON inventory
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 3. COUPON DETAILS TABLE & VIEW ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupon_details (
  id SERIAL PRIMARY KEY,
  coupon_code VARCHAR(255) NOT NULL UNIQUE,
  coupon_discount_type VARCHAR(255) NOT NULL CHECK (coupon_discount_type IN ('percentage', 'fixed')),
  coupon_discount_amount NUMERIC(10,2) NOT NULL,
  coupon_discount_value NUMERIC(10,2) NOT NULL,
  coupon_min_order NUMERIC(10,2) DEFAULT 0,
  coupon_max_uses INT,
  coupon_used_count INT DEFAULT 0,
  coupon_expiry_date DATE,
  coupon_status VARCHAR(20) DEFAULT 'active' CHECK (coupon_status IN ('active', 'inactive')),
  coupon_description TEXT NOT NULL,
  coupon_created_at TIMESTAMPTZ DEFAULT now(),
  coupon_updated_at TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS update_coupon_details_modtime ON coupon_details;
CREATE TRIGGER update_coupon_details_modtime
BEFORE UPDATE ON coupon_details
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Backward compatibility view for frontend coupons queries
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'coupons' AND relkind = 'v') THEN
    DROP VIEW coupons CASCADE;
  ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'coupons' AND relkind = 'r') THEN
    DROP TABLE coupons CASCADE;
  END IF;
END $$;

CREATE OR REPLACE VIEW coupons AS
SELECT
  id::text as id,
  coupon_code as code,
  coupon_discount_type::text as type,
  coupon_discount_value as value,
  coupon_min_order as min_order,
  coupon_max_uses as max_uses,
  coupon_used_count as used_count,
  coupon_expiry_date as expiry_date,
  coupon_status as status,
  coupon_description as description,
  coupon_created_at as created_at
FROM coupon_details;

-- ── 4. USER DETAILS TABLE ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "User_details" (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL UNIQUE,
    user_password VARCHAR(255) NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    user_phone VARCHAR(255) DEFAULT '',
    user_address VARCHAR(255) DEFAULT '',
    user_city VARCHAR(255) DEFAULT '',
    user_state VARCHAR(255) DEFAULT '',
    user_zip VARCHAR(255) DEFAULT '',
    user_country VARCHAR(255) DEFAULT '',
    user_gst VARCHAR(255) DEFAULT '',
    additional_addresses JSONB DEFAULT '[]',
    user_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_User_details_modtime ON "User_details";
CREATE TRIGGER update_User_details_modtime
BEFORE UPDATE ON "User_details"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 5. CONTACT DETAILS TABLE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Contact_details" (
    id SERIAL PRIMARY KEY,
    contact_name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(255) NOT NULL,
    contact_topic VARCHAR(255),
    contact_message TEXT NOT NULL,
    contact_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── 6. CART DETAILS TABLE ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Cart_details" (
    id SERIAL PRIMARY KEY,
    cart_user_id VARCHAR(255) NOT NULL,
    cart_product_id VARCHAR(255) NOT NULL,
    cart_product_quantity VARCHAR(255) NOT NULL,
    cart_product_price VARCHAR(255) NOT NULL,
    cart_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    cart_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_Cart_details_modtime ON "Cart_details";
CREATE TRIGGER update_Cart_details_modtime
BEFORE UPDATE ON "Cart_details"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 7. ORDERS (LEGACY) TABLE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Orders" (
    id SERIAL PRIMARY KEY,
    order_user_id VARCHAR(255) NOT NULL,
    order_product_id VARCHAR(255) NOT NULL,
    order_product_quantity VARCHAR(255) NOT NULL,
    order_product_price VARCHAR(255) NOT NULL,
    order_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    order_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_Orders_modtime ON "Orders";
CREATE TRIGGER update_Orders_modtime
BEFORE UPDATE ON "Orders"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 8. NORMALIZED ORDERS & ORDER ITEMS TABLES ────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(255) PRIMARY KEY,
  order_number VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  status VARCHAR(100) DEFAULT 'pending',
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  shipping_address JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id VARCHAR(255) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL,
  total_price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger function to sync "Orders" inserts to orders & order_items tables
CREATE OR REPLACE FUNCTION sync_orders_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_name TEXT;
  v_phone TEXT;
  v_address TEXT;
  v_city TEXT;
  v_state TEXT;
  v_zip TEXT;
  v_country TEXT;
  v_gst TEXT;
  v_order_id VARCHAR(255);
BEGIN
  SELECT user_name, user_phone, user_address, user_city, user_state, user_zip, user_country, user_gst
  INTO v_name, v_phone, v_address, v_city, v_state, v_zip, v_country, v_gst
  FROM "User_details"
  WHERE user_email = NEW.order_user_id
  LIMIT 1;

  SELECT id::text INTO v_order_id
  FROM "Orders"
  WHERE order_user_id = NEW.order_user_id
    AND order_created_at >= NEW.order_created_at - interval '2 seconds'
  ORDER BY id ASC
  LIMIT 1;

  IF v_order_id IS NULL THEN
    v_order_id := NEW.id::text;
  END IF;

  INSERT INTO orders (id, order_number, user_id, status, total_amount, shipping_address, created_at)
  VALUES (
    v_order_id,
    v_order_id,
    NEW.order_user_id,
    'pending',
    0,
    jsonb_build_object(
      'name', coalesce(v_name, NEW.order_user_id),
      'email', NEW.order_user_id,
      'phone', coalesce(v_phone, ''),
      'address', coalesce(v_address, ''),
      'city', coalesce(v_city, ''),
      'state', coalesce(v_state, ''),
      'zip', coalesce(v_zip, ''),
      'country', coalesce(v_country, ''),
      'gst', coalesce(v_gst, '')
    ),
    NEW.order_created_at
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price, created_at)
  VALUES (
    v_order_id,
    NEW.order_product_id::uuid,
    NEW.order_product_quantity::numeric::integer,
    NEW.order_product_price::numeric,
    (NEW.order_product_quantity::numeric * NEW.order_product_price::numeric),
    NEW.order_created_at
  );

  UPDATE inventory
  SET total_stock = CASE
    WHEN (total_stock - NEW.order_product_quantity::numeric::integer) < 0 THEN 0
    ELSE (total_stock - NEW.order_product_quantity::numeric::integer)
  END,
  updated_at = NOW()
  WHERE product_id = NEW.order_product_id::uuid;

  UPDATE orders
  SET total_amount = (SELECT sum(total_price) FROM order_items WHERE order_id = v_order_id)
  WHERE id = v_order_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_sync_orders ON "Orders";
CREATE TRIGGER trigger_sync_orders
AFTER INSERT ON "Orders"
FOR EACH ROW EXECUTE FUNCTION sync_orders_trigger();

-- ── 9. PAYMENTS TABLE ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Payments" (
    id SERIAL PRIMARY KEY,
    payment_order_id VARCHAR(255) NOT NULL,
    payment_amount VARCHAR(255) NOT NULL,
    payment_status VARCHAR(255) NOT NULL,
    payment_method VARCHAR(255) NOT NULL,
    payment_transaction_id VARCHAR(255) NOT NULL,
    payment_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    payment_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_Payments_modtime ON "Payments";
CREATE TRIGGER update_Payments_modtime
BEFORE UPDATE ON "Payments"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 10. ORDER HISTORY TABLE & STATUS TRIGGER ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "Order_history" (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(255) NOT NULL,
    order_status VARCHAR(255) NOT NULL,
    order_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    order_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_Order_history_modtime ON "Order_history";
CREATE TRIGGER update_Order_history_modtime
BEFORE UPDATE ON "Order_history"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION sync_order_status_trigger()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE orders
  SET status = NEW.order_status
  WHERE id = NEW.order_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_sync_order_status ON "Order_history";
CREATE TRIGGER trigger_sync_order_status
AFTER INSERT OR UPDATE ON "Order_history"
FOR EACH ROW EXECUTE FUNCTION sync_order_status_trigger();

-- ── 11. ADMIN ANALYTICS TABLE ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Admin_analytics" (
    id SERIAL PRIMARY KEY,
    page_name VARCHAR(255) NOT NULL,
    visitor_ip VARCHAR(255) NOT NULL,
    visitor_device VARCHAR(255) NOT NULL,
    visitor_os VARCHAR(255) NOT NULL,
    visitor_browser VARCHAR(255) NOT NULL,
    visitor_country VARCHAR(255) NOT NULL,
    visitor_city VARCHAR(255) NOT NULL,
    visitor_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    visitor_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_Admin_analytics_modtime ON "Admin_analytics";
CREATE TRIGGER update_Admin_analytics_modtime
BEFORE UPDATE ON "Admin_analytics"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 12. ADMIN SETTINGS TABLE (used by admin portal auth) ─────────────────────
CREATE TABLE IF NOT EXISTS admin_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── 13. OTP CODES TABLE ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
    id SERIAL PRIMARY KEY,
    otp VARCHAR(6) NOT NULL,
    domain VARCHAR(50) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── 14. USERS TABLE ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'customer',
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 15. ANALYTICS EVENTS TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  properties JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 16. FESTIVAL DETAILS & DEAL PRODUCTS TABLES & VIEWS ──────────────────────
CREATE TABLE IF NOT EXISTS festival_details (
  id SERIAL PRIMARY KEY,
  festival_title VARCHAR(255) NOT NULL,
  festival_name VARCHAR(255) NOT NULL,
  festival_description TEXT,
  banner_image TEXT,
  discount_type VARCHAR(50) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(10,2) NOT NULL,
  festival_start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  festival_end_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  festival_status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (festival_status IN ('active', 'inactive')),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE festival_details ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

DROP TRIGGER IF EXISTS update_festival_details_modtime ON festival_details;
CREATE TRIGGER update_festival_details_modtime
BEFORE UPDATE ON festival_details
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS festival_deal_products (
  id SERIAL PRIMARY KEY,
  deal_id INT REFERENCES festival_details(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE(deal_id, product_id)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'festive_deals' AND relkind = 'v') THEN
    DROP VIEW festive_deals CASCADE;
  ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'festive_deals' AND relkind = 'r') THEN
    DROP TABLE festive_deals CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'festive_deal_products' AND relkind = 'v') THEN
    DROP VIEW festive_deal_products CASCADE;
  ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'festive_deal_products' AND relkind = 'r') THEN
    DROP TABLE festive_deal_products CASCADE;
  END IF;
END $$;

CREATE OR REPLACE VIEW festive_deals AS
SELECT
  id::text as id,
  festival_title as title,
  festival_name as festival_name,
  festival_description as description,
  banner_image as banner_image,
  discount_type as discount_type,
  discount_value as discount_value,
  festival_start_date as starts_at,
  festival_end_date as ends_at,
  festival_status as status,
  festival_start_date as created_at,
  festival_end_date as updated_at
FROM festival_details;

CREATE OR REPLACE VIEW festive_deal_products AS
SELECT
  id,
  deal_id::text as deal_id,
  product_id
FROM festival_deal_products;

-- ── 17. REVIEW DETAILS TABLE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_details (
  id SERIAL PRIMARY KEY,
  review_product_id VARCHAR(255) NOT NULL,
  review_user_id VARCHAR(255) NOT NULL,
  review_rating VARCHAR(255) NOT NULL,
  review_comment TEXT NOT NULL,
  review_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  review_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_review_details_modtime ON review_details;
CREATE TRIGGER update_review_details_modtime
BEFORE UPDATE ON review_details
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 18. CUSTOMER RESTOCK REQUESTS & RESTOCK FUNCTION ─────────────────────────
CREATE TABLE IF NOT EXISTS customer_restock_requests (
  id SERIAL PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  customer_phone VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  notified_at TIMESTAMP WITH TIME ZONE
);

CREATE OR REPLACE FUNCTION restock_product(
  p_product_id UUID,
  p_quantity INTEGER,
  p_notes TEXT DEFAULT 'Restocked via admin portal'
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO inventory (product_id, total_stock, reserved_stock, low_stock_threshold)
  VALUES (p_product_id, p_quantity, 0, 15)
  ON CONFLICT (product_id)
  DO UPDATE SET
    total_stock = inventory.total_stock + EXCLUDED.total_stock,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 19. FAVORITE DETAILS TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorite_details (
  id SERIAL PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_email, product_id)
);

-- ── 20. SMS ALERT LOGS TABLE & LOW STOCK TRIGGER ──────────────────────────────
CREATE TABLE IF NOT EXISTS sms_alert_logs (
  id SERIAL PRIMARY KEY,
  triggered_by VARCHAR(255) NOT NULL,
  product_id VARCHAR(255),
  product_name VARCHAR(255) NOT NULL,
  stock_at_alert INTEGER NOT NULL,
  threshold INTEGER NOT NULL,
  recipients TEXT[] NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  provider_message_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION trigger_low_stock_sms()
RETURNS TRIGGER AS $$
DECLARE
  v_product_name TEXT;
  v_admin_phone TEXT;
  v_recipients TEXT[];
BEGIN
  IF NEW.total_stock < NEW.low_stock_threshold AND
     (OLD.total_stock >= NEW.low_stock_threshold OR OLD.total_stock IS NULL OR NEW.alert_sent_at IS NULL) THEN

     SELECT name INTO v_product_name FROM products WHERE id = NEW.product_id;
     SELECT value INTO v_admin_phone FROM admin_settings WHERE key = 'admin_phone' LIMIT 1;

     IF v_admin_phone IS NULL OR v_admin_phone = '' THEN
       v_admin_phone := '9876543210';
     END IF;

     v_recipients := ARRAY[v_admin_phone];

     INSERT INTO sms_alert_logs (
       triggered_by,
       product_id,
       product_name,
       stock_at_alert,
       threshold,
       recipients,
       status
     ) VALUES (
       'auto_trigger',
       NEW.product_id::text,
       coalesce(v_product_name, 'Unknown Product'),
       NEW.total_stock,
       NEW.low_stock_threshold,
       v_recipients,
       'pending'
     );

     NEW.alert_sent_at := NOW();
  END IF;

  IF NEW.total_stock >= NEW.low_stock_threshold THEN
     NEW.alert_sent_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_low_stock_sms_alert ON inventory;
CREATE TRIGGER trigger_low_stock_sms_alert
BEFORE UPDATE ON inventory
FOR EACH ROW
EXECUTE FUNCTION trigger_low_stock_sms();

-- ── 21. RATE LIMIT ATTEMPTS TABLE ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  id SERIAL PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL,
  action VARCHAR(50) NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_lookup
  ON rate_limit_attempts(ip_address, action, attempted_at);

-- ── 22. STORAGE: PRODUCT IMAGES BUCKET SETUP ─────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 23. ENABLE RLS ON ALL TABLES ─────────────────────────────────────────────
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

-- ── 24. DROP PERMISSIVE / LEGACY POLICIES ─────────────────────────────────────
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

-- ── 25. PUBLIC READ TABLES (products, inventory, festival_details, reviews) ──

-- 25a. products
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

-- 25b. inventory
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

-- 25c. festival_details
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

-- 25d. festival_deal_products
DROP POLICY IF EXISTS "Public read festival_deal_products" ON festival_deal_products;
CREATE POLICY "Public read festival_deal_products" ON festival_deal_products FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admin write festival_deal_products" ON festival_deal_products;
CREATE POLICY "Admin write festival_deal_products" ON festival_deal_products FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Admin delete festival_deal_products" ON festival_deal_products;
CREATE POLICY "Admin delete festival_deal_products" ON festival_deal_products FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS "Service write festival_deal_products" ON festival_deal_products;
CREATE POLICY "Service write festival_deal_products" ON festival_deal_products FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 25e. review_details
DROP POLICY IF EXISTS "Public read review_details" ON review_details;
CREATE POLICY "Public read review_details" ON review_details FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Anon submit review_details" ON review_details;
CREATE POLICY "Anon submit review_details" ON review_details FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage review_details" ON review_details;
CREATE POLICY "Service manage review_details" ON review_details FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 26. CUSTOMER-OWNED DATA POLICIES ──────────────────────────────────────────

-- 26a. users
DROP POLICY IF EXISTS "Users read own" ON users;
CREATE POLICY "Users read own" ON users FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "Users insert own" ON users;
CREATE POLICY "Users insert own" ON users FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users update own" ON users;
CREATE POLICY "Users update own" ON users FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Service manage users" ON users;
CREATE POLICY "Service manage users" ON users FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 26b. User_details
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

-- 26c. Cart_details
DROP POLICY IF EXISTS "Users manage own cart" ON "Cart_details";
CREATE POLICY "Users manage own cart" ON "Cart_details" FOR ALL TO authenticated USING (cart_user_id = auth.email()) WITH CHECK (cart_user_id = auth.email());

DROP POLICY IF EXISTS "Service manage Cart_details" ON "Cart_details";
CREATE POLICY "Service manage Cart_details" ON "Cart_details" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 26d. Orders (includes auth.jwt() fallback for Razorpay checkout)
DROP POLICY IF EXISTS "Users read own Orders" ON "Orders";
CREATE POLICY "Users read own Orders" ON "Orders" FOR SELECT TO authenticated USING (order_user_id = auth.email() OR order_user_id = (auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Users insert Orders" ON "Orders";
CREATE POLICY "Users insert Orders" ON "Orders" FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage Orders" ON "Orders";
CREATE POLICY "Service manage Orders" ON "Orders" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 26e. orders
DROP POLICY IF EXISTS "Admin read orders" ON orders;
CREATE POLICY "Admin read orders" ON orders FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Users read own orders" ON orders;
CREATE POLICY "Users read own orders" ON orders FOR SELECT TO authenticated USING (user_id = auth.email() OR user_id = (auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Service manage orders" ON orders;
CREATE POLICY "Service manage orders" ON orders FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 26f. order_items
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

-- 26g. Order_history
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

-- 26h. Payments
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

-- 26i. favorite_details
DROP POLICY IF EXISTS "Users manage own favorites" ON favorite_details;
CREATE POLICY "Users manage own favorites" ON favorite_details FOR ALL TO authenticated USING (user_email = auth.email()) WITH CHECK (user_email = auth.email());

DROP POLICY IF EXISTS "Service manage favorite_details" ON favorite_details;
CREATE POLICY "Service manage favorite_details" ON favorite_details FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 27. FORM SUBMISSION & ANALYTICS POLICIES ───────────────────────────────────

-- 27a. Contact_details
DROP POLICY IF EXISTS "Anon submit contact" ON "Contact_details";
CREATE POLICY "Anon submit contact" ON "Contact_details" FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage contacts" ON "Contact_details";
CREATE POLICY "Service manage contacts" ON "Contact_details" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 27b. customer_restock_requests
DROP POLICY IF EXISTS "Admin read restock_requests" ON customer_restock_requests;
CREATE POLICY "Admin read restock_requests" ON customer_restock_requests FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon request restock" ON customer_restock_requests;
CREATE POLICY "Anon request restock" ON customer_restock_requests FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage restock_requests" ON customer_restock_requests;
CREATE POLICY "Service manage restock_requests" ON customer_restock_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 27c. Admin_analytics
DROP POLICY IF EXISTS "Admin read analytics" ON "Admin_analytics";
CREATE POLICY "Admin read analytics" ON "Admin_analytics" FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon insert analytics" ON "Admin_analytics";
CREATE POLICY "Anon insert analytics" ON "Admin_analytics" FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage analytics" ON "Admin_analytics";
CREATE POLICY "Service manage analytics" ON "Admin_analytics" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 27d. analytics_events
DROP POLICY IF EXISTS "Anon insert analytics_events" ON analytics_events;
CREATE POLICY "Anon insert analytics_events" ON analytics_events FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage analytics_events" ON analytics_events;
CREATE POLICY "Service manage analytics_events" ON analytics_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 28. ADMIN & SYSTEM INTERNAL TABLES POLICIES ────────────────────────────────

-- 28a. coupon_details
DROP POLICY IF EXISTS "Admin read coupon_details" ON coupon_details;
CREATE POLICY "Admin read coupon_details" ON coupon_details FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Admin insert coupon_details" ON coupon_details;
CREATE POLICY "Admin insert coupon_details" ON coupon_details FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Admin update coupon_details" ON coupon_details;
CREATE POLICY "Admin update coupon_details" ON coupon_details FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin delete coupon_details" ON coupon_details;
CREATE POLICY "Admin delete coupon_details" ON coupon_details FOR DELETE TO anon USING (true);

-- 28b. sms_alert_logs
DROP POLICY IF EXISTS "Admin read sms_alert_logs" ON sms_alert_logs;
CREATE POLICY "Admin read sms_alert_logs" ON sms_alert_logs FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Service manage sms_alert_logs" ON sms_alert_logs;
CREATE POLICY "Service manage sms_alert_logs" ON sms_alert_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 29. STORAGE POLICIES ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public read product images" ON storage.objects;
CREATE POLICY "Public read product images" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Anon/auth upload product images" ON storage.objects;
CREATE POLICY "Anon/auth upload product images" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Anon/auth update product images" ON storage.objects;
CREATE POLICY "Anon/auth update product images" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'product-images');

-- ── 30. ROLE PERMISSIONS & GRANTS ──────────────────────────────────────────────
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
