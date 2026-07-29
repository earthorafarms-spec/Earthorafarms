-- ═══════════════════════════════════════════════════════════════════════════
-- EARTHORA FARMS — CONSOLIDATED DATABASE SCHEMA
-- File: 01_schema.sql
-- Description: Table structures, views, triggers, functions, catalog seed data, and storage buckets.
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

-- ── 7. ORDERS & ORDER ITEMS TABLES & SYNC TRIGGERS ────────────────────────────
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

-- Normalized orders & order_items tables
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

-- RLS & Grants for orders, Orders, and order_items
ALTER TABLE "Orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to Orders" ON "Orders";
CREATE POLICY "Allow all access to Orders" ON "Orders" FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to orders" ON orders;
CREATE POLICY "Allow all access to orders" ON orders FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to order_items" ON order_items;
CREATE POLICY "Allow all access to order_items" ON order_items FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON "Orders" TO anon, authenticated, service_role;
GRANT ALL ON orders TO anon, authenticated, service_role;
GRANT ALL ON order_items TO anon, authenticated, service_role;


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
  v_order_id VARCHAR(255);
BEGIN
  SELECT user_name, user_phone, user_address, user_city, user_state, user_zip, user_country
  INTO v_name, v_phone, v_address, v_city, v_state, v_zip, v_country
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
      'country', coalesce(v_country, '')
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

-- ── 8. PAYMENTS TABLE ─────────────────────────────────────────────────────────
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

-- ── 9. ORDER HISTORY TABLE & STATUS TRIGGER ───────────────────────────────────
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

-- ── 10. ADMIN ANALYTICS TABLE ─────────────────────────────────────────────────
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

-- ── 11. ADMIN SETTINGS TABLE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── 12. OTP CODES TABLE ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
    id SERIAL PRIMARY KEY,
    otp VARCHAR(6) NOT NULL,
    domain VARCHAR(50) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── 13. USERS TABLE ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'customer',
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 14. ANALYTICS EVENTS TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  properties JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 15. FESTIVAL DETAILS & DEAL PRODUCTS TABLES & VIEWS ────────────────────────
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

-- ── 16. REVIEW DETAILS TABLE ──────────────────────────────────────────────────
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

-- ── 17. CUSTOMER RESTOCK REQUESTS & RESTOCK FUNCTION ─────────────────────────
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

-- ── 18. FAVORITE DETAILS TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorite_details (
  id SERIAL PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_email, product_id)
);

-- ── 19. SMS ALERT LOGS TABLE & LOW STOCK TRIGGER ──────────────────────────────
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

-- ── 20. RATE LIMIT ATTEMPTS TABLE ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  id SERIAL PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL,
  action VARCHAR(50) NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_lookup
  ON rate_limit_attempts(ip_address, action, attempted_at);

-- ── 21. SEED PRODUCT CATALOG ──────────────────────────────────────────────────
INSERT INTO products (slug, name, description, mrp, price, tag, badge, rating, highlights, images, created_at, updated_at) VALUES 
('powder', 'Earthora Pure Moringa Leaf Powder', 'Harvested by hand and stone-ground to preserve nutrients. Perfect for smoothies, teas, and cooking. No additives, ever.', 849.00, 599.00, '8 oz · Resealable Pouch', 'Most Popular', 4.70, ARRAY['100% pure shade-dried moringa leaf powder', 'Stone-ground at low temperature', 'Smooth texture — blends instantly', '8 oz resealable stand-up pouch'], '[{"url": "/assets/generated_images/product_powder.jpg"}]'::jsonb, now(), now()),
('tablets', 'Earthora Pressed Moringa Tablets', 'Our pressed moringa tablets contain nothing but the leaf — no magnesium stearate, no silica. High-pressure pressed for natural binding.', 1099.00, 799.00, '500mg · 120 Tablets', 'Value Pack', 4.80, ARRAY['500 mg pressed moringa per tablet', '120 tablets — 4 month supply', 'Zero binders, fillers, or coatings', 'Biodegradable, plastic-free packaging'], '[{"url": "/assets/generated_images/product_tablets.jpg"}]'::jsonb, now(), now()),
('amla', 'Earthora Organic Amla Powder', 'Pure organic amla (Indian gooseberry) fruit powder. Sourced from organic orchards, stone-ground to capture the high Vitamin C content.', 649.00, 449.00, '8 oz · Resealable Pouch', 'New Release', 4.50, ARRAY['100% organic amla fruit powder', 'Exceptionally high Vitamin C source', 'Natural antioxidant support', 'No added sugar or preservatives'], '[{"url": "/assets/generated_images/hero_leaves.jpg"}]'::jsonb, now(), now())
ON CONFLICT (slug) DO NOTHING;

INSERT INTO inventory (product_id, total_stock, reserved_stock, low_stock_threshold)
SELECT id, 100, 0, 15 FROM products
ON CONFLICT (product_id) DO NOTHING;

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
