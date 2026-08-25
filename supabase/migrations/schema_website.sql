-- ===========================================================================
-- EARTHORA FARMS — WEBSITE SCHEMA (CONSOLIDATED)
-- File: schema_website.sql
-- Consolidates:
--   • 20260808_schema_v2.sql          (main schema, v2 clean)
--   • 20260808064100_coupon_details_permissions.sql  (coupon/festival RLS patch)
--   • 20260813000000_stock_deduction_trigger.sql     (already included in v2, skipped)
-- ===========================================================================

-- ── GLOBAL TRIGGER FUNCTION ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   IF TG_TABLE_NAME = 'User_details' THEN
      NEW.user_updated_at = NOW();
   ELSIF TG_TABLE_NAME = 'Cart_details' THEN
      NEW.cart_updated_at = NOW();
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

-- ── 1. PRODUCTS ──────────────────────────────────────────────────────────────
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
CREATE TRIGGER update_products_modtime BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. INVENTORY ─────────────────────────────────────────────────────────────
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
CREATE TRIGGER update_inventory_modtime BEFORE UPDATE ON inventory
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 3. COUPON DETAILS + VIEW ─────────────────────────────────────────────────
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
CREATE TRIGGER update_coupon_details_modtime BEFORE UPDATE ON coupon_details
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'coupons' AND relkind = 'v') THEN
    DROP VIEW coupons CASCADE;
  ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'coupons' AND relkind = 'r') THEN
    DROP TABLE coupons CASCADE;
  END IF;
END $$;

CREATE OR REPLACE VIEW coupons AS
SELECT id::text AS id, coupon_code AS code, coupon_discount_type::text AS type,
  coupon_discount_value AS value, coupon_min_order AS min_order,
  coupon_max_uses AS max_uses, coupon_used_count AS used_count,
  coupon_expiry_date AS expiry_date, coupon_status AS status,
  coupon_description AS description, coupon_created_at AS created_at
FROM coupon_details;

-- ── 4. USER DETAILS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "User_details" (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL UNIQUE,
    user_password VARCHAR(255) NOT NULL DEFAULT '',
    user_name VARCHAR(255) NOT NULL DEFAULT '',
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
ALTER TABLE "User_details" ALTER COLUMN user_password SET DEFAULT '';
ALTER TABLE "User_details" ALTER COLUMN user_name SET DEFAULT '';
DROP TRIGGER IF EXISTS update_User_details_modtime ON "User_details";
CREATE TRIGGER update_User_details_modtime BEFORE UPDATE ON "User_details"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 4B. KACC USERS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kacc_users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- Default KACC user: add via the admin portal after first deploy
ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password;

-- ── 5. CONTACT DETAILS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Contact_details" (
    id SERIAL PRIMARY KEY,
    contact_name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(255) NOT NULL,
    contact_topic VARCHAR(255),
    contact_message TEXT NOT NULL,
    contact_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── 6. CART DETAILS ──────────────────────────────────────────────────────────
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
CREATE TRIGGER update_Cart_details_modtime BEFORE UPDATE ON "Cart_details"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 7. ORDERS ────────────────────────────────────────────────────────────────
-- checkout.tsx writes here directly. Flat customer_* columns let KACC
-- portal read state/GST without parsing the shipping_address JSONB.
CREATE TABLE IF NOT EXISTS orders (
  id               VARCHAR(255) PRIMARY KEY,
  order_number     VARCHAR(255) NOT NULL,
  user_id          VARCHAR(255) NOT NULL,
  status           VARCHAR(100) DEFAULT 'pending',
  total_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
  shipping_address JSONB NOT NULL DEFAULT '{}',
  customer_name    VARCHAR(255) DEFAULT '',
  customer_email   VARCHAR(255) DEFAULT '',
  customer_phone   VARCHAR(255) DEFAULT '',
  customer_address TEXT         DEFAULT '',
  customer_city    VARCHAR(255) DEFAULT '',
  customer_state   VARCHAR(255) DEFAULT '',
  customer_zip     VARCHAR(255) DEFAULT '',
  customer_country VARCHAR(255) DEFAULT 'India',
  customer_gst     VARCHAR(255) DEFAULT '',
  created_at       TIMESTAMPTZ  DEFAULT now()
);

-- ── 8. ORDER ITEMS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id          SERIAL PRIMARY KEY,
  order_id    VARCHAR(255) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit_price  NUMERIC(10,2) NOT NULL,
  total_price NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 9. ORDER STATUS SYNC: Order_history -> orders.status ─────────────────────
CREATE OR REPLACE FUNCTION sync_order_status_trigger()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE orders SET status = NEW.order_status WHERE id = NEW.order_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 10. PAYMENTS ─────────────────────────────────────────────────────────────
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
CREATE TRIGGER update_Payments_modtime BEFORE UPDATE ON "Payments"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 11. ORDER HISTORY ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Order_history" (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(255) NOT NULL,
    order_status VARCHAR(255) NOT NULL,
    order_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    order_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
DROP TRIGGER IF EXISTS update_Order_history_modtime ON "Order_history";
CREATE TRIGGER update_Order_history_modtime BEFORE UPDATE ON "Order_history"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trigger_sync_order_status ON "Order_history";
CREATE TRIGGER trigger_sync_order_status AFTER INSERT OR UPDATE ON "Order_history"
FOR EACH ROW EXECUTE FUNCTION sync_order_status_trigger();

-- ── 12. ADMIN ANALYTICS ──────────────────────────────────────────────────────
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
CREATE TRIGGER update_Admin_analytics_modtime BEFORE UPDATE ON "Admin_analytics"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 13. ADMIN SETTINGS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── 14. OTP CODES ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
    id SERIAL PRIMARY KEY,
    otp VARCHAR(64) NOT NULL, -- stores SHA-256 hash of the 6-digit OTP
    domain VARCHAR(50) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── 15. ANALYTICS EVENTS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  properties JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 16. FESTIVAL DETAILS + DEAL PRODUCTS ─────────────────────────────────────
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
  festival_status VARCHAR(50) NOT NULL DEFAULT 'active'
    CHECK (festival_status IN ('active', 'inactive')),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE festival_details
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
DROP TRIGGER IF EXISTS update_festival_details_modtime ON festival_details;
CREATE TRIGGER update_festival_details_modtime BEFORE UPDATE ON festival_details
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
END $$;
CREATE OR REPLACE VIEW festive_deals AS
SELECT id::text AS id, festival_title AS title, festival_name,
  festival_description AS description, banner_image, discount_type, discount_value,
  festival_start_date AS starts_at, festival_end_date AS ends_at,
  festival_status AS status, festival_start_date AS created_at,
  festival_end_date AS updated_at
FROM festival_details;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'festive_deal_products' AND relkind = 'v') THEN
    DROP VIEW festive_deal_products CASCADE;
  END IF;
  -- Do NOT drop the TABLE festival_deal_products here
END $$;
CREATE OR REPLACE VIEW festive_deal_products AS
SELECT id, deal_id::text AS deal_id, product_id
FROM festival_deal_products;

-- ── 17. REVIEW DETAILS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_details (
  id SERIAL PRIMARY KEY,
  review_product_id VARCHAR(255) NOT NULL,
  review_user_id VARCHAR(255) NOT NULL,
  review_rating NUMERIC(2,1) NOT NULL CHECK (review_rating BETWEEN 1 AND 5),
  review_comment TEXT NOT NULL,
  review_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  review_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
DROP TRIGGER IF EXISTS update_review_details_modtime ON review_details;
CREATE TRIGGER update_review_details_modtime BEFORE UPDATE ON review_details
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 18. CUSTOMER RESTOCK REQUESTS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_restock_requests (
  id SERIAL PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  customer_phone VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  notified_at TIMESTAMP WITH TIME ZONE
);
CREATE OR REPLACE FUNCTION restock_product(
  p_product_id UUID, p_quantity INTEGER,
  p_notes TEXT DEFAULT 'Restocked via admin portal'
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO inventory (product_id, total_stock, reserved_stock, low_stock_threshold)
  VALUES (p_product_id, p_quantity, 0, 15)
  ON CONFLICT (product_id) DO UPDATE SET
    total_stock = inventory.total_stock + EXCLUDED.total_stock,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 19. FAVORITE DETAILS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorite_details (
  id SERIAL PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_email, product_id)
);

-- ── 20. SMS ALERT LOGS + LOW STOCK TRIGGER ───────────────────────────────────
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
  v_product_name TEXT; v_admin_phone TEXT; v_recipients TEXT[];
BEGIN
  IF NEW.total_stock < NEW.low_stock_threshold AND
     (OLD.total_stock >= NEW.low_stock_threshold OR OLD.total_stock IS NULL OR NEW.alert_sent_at IS NULL) THEN
    SELECT name INTO v_product_name FROM products WHERE id = NEW.product_id;
    SELECT value INTO v_admin_phone FROM admin_settings WHERE key = 'admin_phone' LIMIT 1;
    IF v_admin_phone IS NULL OR v_admin_phone = '' THEN v_admin_phone := '9876543210'; END IF;
    v_recipients := ARRAY[v_admin_phone];
    INSERT INTO sms_alert_logs (triggered_by, product_id, product_name, stock_at_alert, threshold, recipients, status)
    VALUES ('auto_trigger', NEW.product_id::text, coalesce(v_product_name,'Unknown Product'),
            NEW.total_stock, NEW.low_stock_threshold, v_recipients, 'pending');
    NEW.alert_sent_at := NOW();
  END IF;
  IF NEW.total_stock >= NEW.low_stock_threshold THEN NEW.alert_sent_at := NULL; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS trigger_low_stock_sms_alert ON inventory;
CREATE TRIGGER trigger_low_stock_sms_alert BEFORE UPDATE ON inventory
FOR EACH ROW EXECUTE FUNCTION trigger_low_stock_sms();

-- ── 21. RATE LIMIT ATTEMPTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  id SERIAL PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL,
  action VARCHAR(50) NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_lookup
  ON rate_limit_attempts(ip_address, action, attempted_at);

-- ── 22. STORAGE BUCKET ───────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images','product-images',true,10485760,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = true, file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp'];

-- ── 23. INVENTORY STOCK DEDUCTION & RESTORATION TRIGGERS ─────────────────────
CREATE OR REPLACE FUNCTION reduce_stock_on_order_item()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory
  SET total_stock = GREATEST(0, total_stock - NEW.quantity),
      updated_at = NOW()
  WHERE product_id = NEW.product_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_reduce_stock_on_order_item ON order_items;
CREATE TRIGGER trigger_reduce_stock_on_order_item
AFTER INSERT ON order_items
FOR EACH ROW EXECUTE FUNCTION reduce_stock_on_order_item();

CREATE OR REPLACE FUNCTION handle_order_cancellation_stock()
RETURNS TRIGGER AS $$
DECLARE
  item RECORD;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    FOR item IN SELECT product_id, quantity FROM order_items WHERE order_id = NEW.id LOOP
      UPDATE inventory
      SET total_stock = total_stock + item.quantity,
          updated_at = NOW()
      WHERE product_id = item.product_id;
    END LOOP;
  ELSIF OLD.status = 'cancelled' AND NEW.status != 'cancelled' THEN
    FOR item IN SELECT product_id, quantity FROM order_items WHERE order_id = NEW.id LOOP
      UPDATE inventory
      SET total_stock = GREATEST(0, total_stock - item.quantity),
          updated_at = NOW()
      WHERE product_id = item.product_id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_handle_order_cancellation_stock ON orders;
CREATE TRIGGER trigger_handle_order_cancellation_stock
AFTER UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION handle_order_cancellation_stock();

CREATE OR REPLACE FUNCTION restore_stock_on_order_item_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory
  SET total_stock = total_stock + OLD.quantity,
      updated_at = NOW()
  WHERE product_id = OLD.product_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_restore_stock_on_order_item_delete ON order_items;
CREATE TRIGGER trigger_restore_stock_on_order_item_delete
AFTER DELETE ON order_items
FOR EACH ROW EXECUTE FUNCTION restore_stock_on_order_item_delete();

-- ===========================================================================
-- ROW LEVEL SECURITY
-- ===========================================================================
ALTER TABLE products                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User_details"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact_details"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cart_details"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payments"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order_history"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Admin_analytics"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE kacc_users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_details            ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_details          ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_deal_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items               ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_details            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_restock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorite_details          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_alert_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_attempts       ENABLE ROW LEVEL SECURITY;

-- Drop leftover broad permissive policies
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE policyname = 'Allow anon/authenticated operations'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- products
DROP POLICY IF EXISTS "Public read products"   ON products;
CREATE POLICY "Public read products"   ON products FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admin write products"   ON products;
CREATE POLICY "Admin write products"   ON products FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Admin update products"  ON products;
CREATE POLICY "Admin update products"  ON products FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin delete products"  ON products;
CREATE POLICY "Admin delete products"  ON products FOR DELETE TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Service write products" ON products;
CREATE POLICY "Service write products" ON products FOR ALL TO service_role USING (true) WITH CHECK (true);

-- inventory
DROP POLICY IF EXISTS "Public read inventory"   ON inventory;
CREATE POLICY "Public read inventory"   ON inventory FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admin write inventory"   ON inventory;
CREATE POLICY "Admin write inventory"   ON inventory FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Admin update inventory"  ON inventory;
CREATE POLICY "Admin update inventory"  ON inventory FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin delete inventory"  ON inventory;
CREATE POLICY "Admin delete inventory"  ON inventory FOR DELETE TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Service write inventory" ON inventory;
CREATE POLICY "Service write inventory" ON inventory FOR ALL TO service_role USING (true) WITH CHECK (true);

-- festival_details (patched to include authenticated for write operations)
DROP POLICY IF EXISTS "Public read festival_details"   ON festival_details;
CREATE POLICY "Public read festival_details"   ON festival_details FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admin write festival_details"   ON festival_details;
CREATE POLICY "Admin write festival_details"   ON festival_details FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Admin update festival_details"  ON festival_details;
CREATE POLICY "Admin update festival_details"  ON festival_details FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin delete festival_details"  ON festival_details;
CREATE POLICY "Admin delete festival_details"  ON festival_details FOR DELETE TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Service write festival_details" ON festival_details;
CREATE POLICY "Service write festival_details" ON festival_details FOR ALL TO service_role USING (true) WITH CHECK (true);

-- festival_deal_products (patched to include authenticated)
DROP POLICY IF EXISTS "Public read festival_deal_products"   ON festival_deal_products;
CREATE POLICY "Public read festival_deal_products"   ON festival_deal_products FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admin write festival_deal_products"   ON festival_deal_products;
CREATE POLICY "Admin write festival_deal_products"   ON festival_deal_products FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Admin delete festival_deal_products"  ON festival_deal_products;
CREATE POLICY "Admin delete festival_deal_products"  ON festival_deal_products FOR DELETE TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Service write festival_deal_products" ON festival_deal_products;
CREATE POLICY "Service write festival_deal_products" ON festival_deal_products FOR ALL TO service_role USING (true) WITH CHECK (true);

-- review_details
DROP POLICY IF EXISTS "Public read review_details"    ON review_details;
CREATE POLICY "Public read review_details"    ON review_details FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Anon submit review_details"    ON review_details;
DROP POLICY IF EXISTS "Authenticated submit review_details" ON review_details;
CREATE POLICY "Authenticated submit review_details" ON review_details FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Service manage review_details" ON review_details;
CREATE POLICY "Service manage review_details" ON review_details FOR ALL TO service_role USING (true) WITH CHECK (true);

-- User_details
DROP POLICY IF EXISTS "Users read own User_details"    ON "User_details";
CREATE POLICY "Users read own User_details"    ON "User_details" FOR SELECT TO authenticated USING (user_email = auth.email());
DROP POLICY IF EXISTS "Anyone can insert User_details" ON "User_details";
CREATE POLICY "Anyone can insert User_details" ON "User_details" FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Users insert own User_details"  ON "User_details";
CREATE POLICY "Users insert own User_details"  ON "User_details" FOR INSERT TO authenticated WITH CHECK (user_email = auth.email());
DROP POLICY IF EXISTS "Users update own User_details"  ON "User_details";
CREATE POLICY "Users update own User_details"  ON "User_details" FOR UPDATE TO authenticated USING (user_email = auth.email()) WITH CHECK (user_email = auth.email());
DROP POLICY IF EXISTS "Service manage User_details"    ON "User_details";
CREATE POLICY "Service manage User_details"    ON "User_details" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Cart_details
DROP POLICY IF EXISTS "Users manage own cart"      ON "Cart_details";
CREATE POLICY "Users manage own cart"      ON "Cart_details" FOR ALL TO authenticated USING (cart_user_id = auth.email()) WITH CHECK (cart_user_id = auth.email());
DROP POLICY IF EXISTS "Service manage Cart_details" ON "Cart_details";
CREATE POLICY "Service manage Cart_details" ON "Cart_details" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- orders
DROP POLICY IF EXISTS "Admin read orders"     ON orders;
CREATE POLICY "Admin read orders"     ON orders FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Users read own orders" ON orders;
CREATE POLICY "Users read own orders" ON orders FOR SELECT TO authenticated USING (user_id = auth.email() OR user_id = (auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS "Admin manage orders"         ON orders;
DROP POLICY IF EXISTS "Anon checkout insert orders" ON orders;
CREATE POLICY "Anon checkout insert orders"
  ON orders FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Auth checkout insert orders" ON orders;
CREATE POLICY "Auth checkout insert orders"
  ON orders FOR INSERT TO authenticated WITH CHECK (true);
-- NOTE: SELECT TO anon is kept via "Admin read orders" for the admin portal.
-- Long-term: route admin order reads through a service-role proxy.
DROP POLICY IF EXISTS "Service manage orders" ON orders;
CREATE POLICY "Service manage orders" ON orders FOR ALL TO service_role USING (true) WITH CHECK (true);

-- order_items
DROP POLICY IF EXISTS "Admin read order_items"     ON order_items;
CREATE POLICY "Admin read order_items"     ON order_items FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Users read own order_items" ON order_items;
CREATE POLICY "Users read own order_items" ON order_items FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id
    AND (orders.user_id = auth.email() OR orders.user_id = (auth.jwt() ->> 'email')))
);
DROP POLICY IF EXISTS "Admin manage order_items"          ON order_items;
DROP POLICY IF EXISTS "Anon checkout insert order_items"  ON order_items;
CREATE POLICY "Anon checkout insert order_items"
  ON order_items FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Auth checkout insert order_items"  ON order_items;
CREATE POLICY "Auth checkout insert order_items"
  ON order_items FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Admin read order_items" ON order_items;
CREATE POLICY "Admin read order_items"
  ON order_items FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Users read own order_items" ON order_items;
CREATE POLICY "Users read own order_items"
  ON order_items FOR SELECT TO authenticated
  USING (order_id IN (
    SELECT id FROM orders
    WHERE user_id = auth.email() OR user_id = (auth.jwt() ->> 'email')
  ));
DROP POLICY IF EXISTS "Service manage order_items" ON order_items;
CREATE POLICY "Service manage order_items" ON order_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Order_history
DROP POLICY IF EXISTS "Admin read Order_history"     ON "Order_history";
CREATE POLICY "Admin read Order_history"     ON "Order_history" FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Admin insert Order_history"   ON "Order_history";
CREATE POLICY "Admin insert Order_history"   ON "Order_history" FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Users read own Order_history" ON "Order_history";
CREATE POLICY "Users read own Order_history" ON "Order_history" FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM orders WHERE orders.id = "Order_history".order_id
    AND (orders.user_id = auth.email() OR orders.user_id = (auth.jwt() ->> 'email')))
);
DROP POLICY IF EXISTS "Users insert Order_history"   ON "Order_history";
CREATE POLICY "Users insert Order_history"   ON "Order_history" FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Service manage Order_history" ON "Order_history";
CREATE POLICY "Service manage Order_history" ON "Order_history" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Payments
DROP POLICY IF EXISTS "Admin read Payments"     ON "Payments";
CREATE POLICY "Admin read Payments"     ON "Payments" FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Users read own Payments" ON "Payments";
CREATE POLICY "Users read own Payments" ON "Payments" FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM orders WHERE orders.id = "Payments".payment_order_id
    AND (orders.user_id = auth.email() OR orders.user_id = (auth.jwt() ->> 'email')))
);
DROP POLICY IF EXISTS "Users insert Payments"   ON "Payments";
CREATE POLICY "Users insert Payments"   ON "Payments" FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Service manage Payments" ON "Payments";
CREATE POLICY "Service manage Payments" ON "Payments" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- favorite_details
DROP POLICY IF EXISTS "Users manage own favorites"     ON favorite_details;
CREATE POLICY "Users manage own favorites"     ON favorite_details FOR ALL TO authenticated USING (user_email = auth.email()) WITH CHECK (user_email = auth.email());
DROP POLICY IF EXISTS "Service manage favorite_details" ON favorite_details;
CREATE POLICY "Service manage favorite_details" ON favorite_details FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Contact_details
DROP POLICY IF EXISTS "Anon submit contact"     ON "Contact_details";
CREATE POLICY "Anon submit contact"     ON "Contact_details" FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Service manage contacts" ON "Contact_details";
CREATE POLICY "Service manage contacts" ON "Contact_details" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- customer_restock_requests
DROP POLICY IF EXISTS "Admin read restock_requests"     ON customer_restock_requests;
CREATE POLICY "Admin read restock_requests"     ON customer_restock_requests FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Anon request restock"            ON customer_restock_requests;
CREATE POLICY "Anon request restock"            ON customer_restock_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Service manage restock_requests" ON customer_restock_requests;
CREATE POLICY "Service manage restock_requests" ON customer_restock_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admin_analytics
DROP POLICY IF EXISTS "Admin read analytics"     ON "Admin_analytics";
CREATE POLICY "Admin read analytics"     ON "Admin_analytics" FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Anon insert analytics"    ON "Admin_analytics";
CREATE POLICY "Anon insert analytics"    ON "Admin_analytics" FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Service manage analytics" ON "Admin_analytics";
CREATE POLICY "Service manage analytics" ON "Admin_analytics" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- analytics_events
DROP POLICY IF EXISTS "Anon insert analytics_events"    ON analytics_events;
CREATE POLICY "Anon insert analytics_events"    ON analytics_events FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Service manage analytics_events" ON analytics_events;
CREATE POLICY "Service manage analytics_events" ON analytics_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- coupon_details (patched: includes authenticated for all write operations)
DROP POLICY IF EXISTS "Admin read coupon_details"   ON coupon_details;
CREATE POLICY "Admin read coupon_details"   ON coupon_details FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admin insert coupon_details" ON coupon_details;
CREATE POLICY "Admin insert coupon_details" ON coupon_details FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Admin update coupon_details" ON coupon_details;
CREATE POLICY "Admin update coupon_details" ON coupon_details FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin delete coupon_details" ON coupon_details;
CREATE POLICY "Admin delete coupon_details" ON coupon_details FOR DELETE TO anon, authenticated USING (true);

-- sms_alert_logs
DROP POLICY IF EXISTS "Admin read sms_alert_logs"     ON sms_alert_logs;
CREATE POLICY "Admin read sms_alert_logs"     ON sms_alert_logs FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Service manage sms_alert_logs" ON sms_alert_logs;
CREATE POLICY "Service manage sms_alert_logs" ON sms_alert_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- kacc_users
DROP POLICY IF EXISTS "Service manage kacc_users" ON kacc_users;
CREATE POLICY "Service manage kacc_users"
  ON kacc_users FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin read kacc_users" ON kacc_users;
CREATE POLICY "Admin read kacc_users"
  ON kacc_users FOR SELECT TO anon, authenticated USING (true);

-- admin_settings
DROP POLICY IF EXISTS "Service manage admin_settings" ON admin_settings;
CREATE POLICY "Service manage admin_settings"
  ON admin_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin read admin_settings" ON admin_settings;
CREATE POLICY "Admin read admin_settings"
  ON admin_settings FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Admin update admin_settings" ON admin_settings;
CREATE POLICY "Admin update admin_settings"
  ON admin_settings FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- customer_restock_requests unique constraint (M-06)
ALTER TABLE customer_restock_requests
  ADD CONSTRAINT unique_restock_per_product_phone
    UNIQUE (product_id, customer_phone);

-- Storage
DROP POLICY IF EXISTS "Public read product images"      ON storage.objects;
CREATE POLICY "Public read product images"      ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'product-images');
DROP POLICY IF EXISTS "Anon/auth upload product images" ON storage.objects;
CREATE POLICY "Anon/auth upload product images" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'product-images');
DROP POLICY IF EXISTS "Anon/auth update product images" ON storage.objects;
CREATE POLICY "Anon/auth update product images" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'product-images');

-- ===========================================================================
-- GRANTS
-- ===========================================================================
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL   ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT ON products, inventory, festival_details, festival_deal_products,
  review_details, coupons, orders, order_items, "Admin_analytics", "Order_history",
  "Payments", coupon_details, customer_restock_requests, sms_alert_logs
  TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON products, inventory TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON festival_details    TO anon, authenticated;
GRANT INSERT, DELETE         ON festival_deal_products TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON coupon_details TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON orders, order_items TO anon, authenticated;
-- kacc_users: RLS restricts writes to service_role only; no direct anon writes
GRANT INSERT                 ON "Order_history"     TO anon;
GRANT INSERT                 ON review_details, "Contact_details",
  customer_restock_requests, "Admin_analytics", analytics_events
  TO anon, authenticated;

GRANT INSERT                         ON "User_details"  TO anon;
GRANT SELECT, INSERT, UPDATE         ON "User_details"  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cart_details"  TO authenticated;
GRANT SELECT, INSERT                 ON "Payments"      TO anon, authenticated;
GRANT SELECT, INSERT                 ON "Order_history" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON orders, order_items TO anon, authenticated;
GRANT SELECT, INSERT, DELETE         ON favorite_details TO authenticated;

REVOKE EXECUTE ON FUNCTION restock_product           FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION trigger_low_stock_sms     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION sync_order_status_trigger FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION restock_product           TO service_role;
GRANT  EXECUTE ON FUNCTION trigger_low_stock_sms     TO service_role;
GRANT  EXECUTE ON FUNCTION sync_order_status_trigger TO service_role;

GRANT EXECUTE ON FUNCTION reduce_stock_on_order_item         TO service_role, anon, authenticated;
GRANT EXECUTE ON FUNCTION handle_order_cancellation_stock    TO service_role, anon, authenticated;
GRANT EXECUTE ON FUNCTION restore_stock_on_order_item_delete TO service_role, anon, authenticated;
