-- ── TRIGGERS & FUNCTIONS ──────────────────────────────────────────────────────
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
      NEW.festival_end_date = NOW();
   END IF;
   RETURN NEW;
END;
$$ language 'plpgsql';

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

-- ── 3. COUPON DETAILS TABLE ───────────────────────────────────────────────────
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

-- ── 4. User_details TABLE ─────────────────────────────────────────────────────
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
    user_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_User_details_modtime ON "User_details";
CREATE TRIGGER update_User_details_modtime
BEFORE UPDATE ON "User_details"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 5. Contact_details TABLE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Contact_details" (
    id SERIAL PRIMARY KEY,
    contact_name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(255) NOT NULL,
    contact_topic VARCHAR(255),
    contact_message TEXT NOT NULL,
    contact_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── 6. Cart_details TABLE ─────────────────────────────────────────────────────
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

-- ── 7. Orders TABLE ───────────────────────────────────────────────────────────
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

-- Backward compatibility tables for Orders & order_items
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'orders' AND relkind = 'v') THEN
    DROP VIEW orders CASCADE;
  ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'orders' AND relkind = 'r') THEN
    DROP TABLE orders CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'order_items' AND relkind = 'v') THEN
    DROP VIEW order_items CASCADE;
  ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'order_items' AND relkind = 'r') THEN
    DROP TABLE order_items CASCADE;
  END IF;
END $$;

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

-- Trigger to sync "Orders" inserts to orders & order_items tables
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
  -- Get user details if they exist
  SELECT user_name, user_phone, user_address, user_city, user_state, user_zip, user_country
  INTO v_name, v_phone, v_address, v_city, v_state, v_zip, v_country
  FROM "User_details"
  WHERE user_email = NEW.order_user_id
  LIMIT 1;

  -- Use the first inserted item's ID as the order ID group
  SELECT id::text INTO v_order_id
  FROM "Orders"
  WHERE order_user_id = NEW.order_user_id 
    AND order_created_at >= NEW.order_created_at - interval '2 seconds'
  ORDER BY id ASC
  LIMIT 1;

  IF v_order_id IS NULL THEN
    v_order_id := NEW.id::text;
  END IF;

  -- Insert parent order if not exists
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

  -- Insert order item
  INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price, created_at)
  VALUES (
    v_order_id,
    NEW.order_product_id::uuid,
    NEW.order_product_quantity::numeric::integer,
    NEW.order_product_price::numeric,
    (NEW.order_product_quantity::numeric * NEW.order_product_price::numeric),
    NEW.order_created_at
  );

  -- Decrement stock in inventory
  UPDATE inventory
  SET total_stock = CASE 
    WHEN (total_stock - NEW.order_product_quantity::numeric::integer) < 0 THEN 0 
    ELSE (total_stock - NEW.order_product_quantity::numeric::integer) 
  END,
  updated_at = NOW()
  WHERE product_id = NEW.order_product_id::uuid;

  -- Recalculate total amount
  UPDATE orders
  SET total_amount = (SELECT sum(total_price) FROM order_items WHERE order_id = v_order_id)
  WHERE id = v_order_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_orders ON "Orders";
CREATE TRIGGER trigger_sync_orders
AFTER INSERT ON "Orders"
FOR EACH ROW EXECUTE FUNCTION sync_orders_trigger();

-- Trigger to sync status updates from Order_history to orders
CREATE OR REPLACE FUNCTION sync_order_status_trigger()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE orders
  SET status = NEW.order_status
  WHERE id = NEW.order_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_order_status ON "Order_history";
CREATE TRIGGER trigger_sync_order_status
AFTER INSERT OR UPDATE ON "Order_history"
FOR EACH ROW EXECUTE FUNCTION sync_order_status_trigger();

-- ── 8. Payments TABLE ─────────────────────────────────────────────────────────
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

-- ── 9. Order_history TABLE ────────────────────────────────────────────────────
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

-- ── 10. Admin_analytics TABLE ─────────────────────────────────────────────────
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

-- ── 11. admin_settings TABLE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── 12. otp_codes TABLE ───────────────────────────────────────────────────────
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

-- ── 13. FESTIVAL DETAILS TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS festival_details (
  id SERIAL PRIMARY KEY,
  festival_title VARCHAR(255) NOT NULL,
  festival_name VARCHAR(255) NOT NULL,
  festival_description TEXT NOT NULL,
  banner_image VARCHAR(255),
  discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(10,2) NOT NULL,
  festival_status VARCHAR(20) DEFAULT 'active' CHECK (festival_status IN ('active', 'inactive')),
  festival_start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  festival_end_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_festival_details_modtime ON festival_details;
CREATE TRIGGER update_festival_details_modtime
BEFORE UPDATE ON festival_details
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Junction table linking products to festival deals
CREATE TABLE IF NOT EXISTS festival_deal_products (
  id SERIAL PRIMARY KEY,
  deal_id INT REFERENCES festival_details(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE(deal_id, product_id)
);

-- Backward compatibility views for festive deals queries
DO $$ 
BEGIN
  -- festive_deals
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'festive_deals' AND relkind = 'v') THEN
    DROP VIEW festive_deals CASCADE;
  ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'festive_deals' AND relkind = 'r') THEN
    DROP TABLE festive_deals CASCADE;
  END IF;

  -- festive_deal_products
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
  created_at as created_at,
  updated_at as updated_at
FROM (
  SELECT 
    id, festival_title, festival_name, festival_description, banner_image, discount_type, discount_value, festival_start_date, festival_end_date, festival_status,
    festival_start_date as created_at, festival_end_date as updated_at
  FROM festival_details
) fd;

CREATE OR REPLACE VIEW festive_deal_products AS
SELECT 
  id,
  deal_id::text as deal_id,
  product_id
FROM festival_deal_products;

-- ── Seed Product Catalog ──────────────────────────────────────────────────────
INSERT INTO products (slug, name, description, mrp, price, tag, badge, rating, highlights, images, created_at, updated_at) VALUES 
('capsules', 'Earthora Organic Moringa Capsules', 'Our premium moringa capsules deliver the full nutritional profile of fresh moringa leaves in a convenient daily format. Sourced from our family farm.', 999.00, 699.00, '500mg · 90 Capsules', 'Best Seller', 4.60, ARRAY['500 mg organic moringa leaf per capsule', '90 vegetable capsules — 3 month supply', 'No fillers, binders, or flow agents', 'Third-party tested for purity & potency'], '[{"url": "/assets/generated_images/product_capsules.jpg"}]'::jsonb, now(), now()),

('powder', 'Earthora Pure Moringa Leaf Powder', 'Harvested by hand and stone-ground to preserve nutrients. Perfect for smoothies, teas, and cooking. No additives, ever.', 849.00, 599.00, '8 oz · Resealable Pouch', 'Most Popular', 4.70, ARRAY['100% pure shade-dried moringa leaf powder', 'Stone-ground at low temperature', 'Smooth texture — blends instantly', '8 oz resealable stand-up pouch'], '[{"url": "/assets/generated_images/product_powder.jpg"}]'::jsonb, now(), now()),

('tablets', 'Earthora Pressed Moringa Tablets', 'Our pressed moringa tablets contain nothing but the leaf — no magnesium stearate, no silica. High-pressure pressed for natural binding.', 1099.00, 799.00, '500mg · 120 Tablets', 'Value Pack', 4.80, ARRAY['500 mg pressed moringa per tablet', '120 tablets — 4 month supply', 'Zero binders, fillers, or coatings', 'Biodegradable, plastic-free packaging'], '[{"url": "/assets/generated_images/product_tablets.jpg"}]'::jsonb, now(), now()),

('amla', 'Earthora Organic Amla Powder', 'Pure organic amla (Indian gooseberry) fruit powder. Sourced from organic orchards, stone-ground to capture the high Vitamin C content.', 649.00, 449.00, '8 oz · Resealable Pouch', 'New Release', 4.50, ARRAY['100% organic amla fruit powder', 'Exceptionally high Vitamin C source', 'Natural antioxidant support', 'No added sugar or preservatives'], '[{"url": "/assets/generated_images/hero_leaves.jpg"}]'::jsonb, now(), now())
ON CONFLICT (slug) DO NOTHING;

INSERT INTO inventory (product_id, total_stock, reserved_stock, low_stock_threshold)
SELECT id, 100, 0, 15 FROM products
ON CONFLICT (product_id) DO NOTHING;

-- ── Enable RLS & Open Policies ───────────────────────────────────────────────
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

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON products;
CREATE POLICY "Allow anon/authenticated operations" ON products FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON inventory;
CREATE POLICY "Allow anon/authenticated operations" ON inventory FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON "User_details";
CREATE POLICY "Allow anon/authenticated operations" ON "User_details" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON "Contact_details";
CREATE POLICY "Allow anon/authenticated operations" ON "Contact_details" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON "Cart_details";
CREATE POLICY "Allow anon/authenticated operations" ON "Cart_details" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON "Orders";
CREATE POLICY "Allow anon/authenticated operations" ON "Orders" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON "Payments";
CREATE POLICY "Allow anon/authenticated operations" ON "Payments" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON "Order_history";
CREATE POLICY "Allow anon/authenticated operations" ON "Order_history" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON "Admin_analytics";
CREATE POLICY "Allow anon/authenticated operations" ON "Admin_analytics" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON admin_settings;
-- Locked: No public policies exist for admin_settings. Only service_role can access.

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON otp_codes;
-- Locked: No public policies exist for otp_codes. Only service_role can access.

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON coupon_details;
CREATE POLICY "Allow anon/authenticated operations" ON coupon_details FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON festival_details;
CREATE POLICY "Allow anon/authenticated operations" ON festival_details FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON festival_deal_products;
CREATE POLICY "Allow anon/authenticated operations" ON festival_deal_products FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON users;
CREATE POLICY "Allow anon/authenticated operations" ON users FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON analytics_events;
CREATE POLICY "Allow anon/authenticated operations" ON analytics_events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON orders;
CREATE POLICY "Allow anon/authenticated operations" ON orders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON order_items;
CREATE POLICY "Allow anon/authenticated operations" ON order_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ── Grant Schema & Table Access Privileges ────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- ── Storage: product-images bucket ────────────────────────────────────────────
-- Create the bucket if it doesn't exist (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

-- Open storage RLS policies so anon/authenticated can read & upload
DROP POLICY IF EXISTS "Public read product images" ON storage.objects;
CREATE POLICY "Public read product images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Anon/auth upload product images" ON storage.objects;
CREATE POLICY "Anon/auth upload product images"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Anon/auth update product images" ON storage.objects;
CREATE POLICY "Anon/auth update product images"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'product-images');

-- ── 16. Backfill existing orders from "Orders" table if not synced ─────────────
DO $$
DECLARE
  r RECORD;
  v_name TEXT;
  v_phone TEXT;
  v_address TEXT;
  v_city TEXT;
  v_state TEXT;
  v_zip TEXT;
  v_country TEXT;
  v_order_id VARCHAR(255);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'Orders') THEN
    FOR r IN SELECT * FROM "Orders" ORDER BY id ASC LOOP
      -- Get user details
      SELECT user_name, user_phone, user_address, user_city, user_state, user_zip, user_country
      INTO v_name, v_phone, v_address, v_city, v_state, v_zip, v_country
      FROM "User_details"
      WHERE user_email = r.order_user_id
      LIMIT 1;

      -- Group items by checking if we have an item created around the same time
      SELECT id::text INTO v_order_id
      FROM "Orders"
      WHERE order_user_id = r.order_user_id 
        AND order_created_at >= r.order_created_at - interval '2 seconds'
      ORDER BY id ASC
      LIMIT 1;

      IF v_order_id IS NULL THEN
        v_order_id := r.id::text;
      END IF;

      -- Insert parent order if not exists
      INSERT INTO orders (id, order_number, user_id, status, total_amount, shipping_address, created_at)
      VALUES (
        v_order_id,
        v_order_id,
        r.order_user_id,
        coalesce((SELECT order_status FROM "Order_history" WHERE order_id = v_order_id LIMIT 1), 'pending'),
        0,
        jsonb_build_object(
          'name', coalesce(v_name, r.order_user_id),
          'email', r.order_user_id,
          'phone', coalesce(v_phone, ''),
          'address', coalesce(v_address, ''),
          'city', coalesce(v_city, ''),
          'state', coalesce(v_state, ''),
          'zip', coalesce(v_zip, ''),
          'country', coalesce(v_country, '')
        ),
        r.order_created_at
      )
      ON CONFLICT (id) DO NOTHING;

      -- Insert order item
      IF EXISTS (SELECT 1 FROM products WHERE id = r.order_product_id::uuid) THEN
        INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price, created_at)
        VALUES (
          v_order_id,
          r.order_product_id::uuid,
          r.order_product_quantity::numeric::integer,
          r.order_product_price::numeric,
          (r.order_product_quantity::numeric * r.order_product_price::numeric),
          r.order_created_at
        )
        ON CONFLICT DO NOTHING;
      END IF;

      -- Recalculate total amount
      UPDATE orders
      SET total_amount = (SELECT sum(total_price) FROM order_items WHERE order_id = v_order_id)
      WHERE id = v_order_id;
    END LOOP;
  END IF;
END $$;

-- ── 17. REVIEW DETAILS TABLE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_details (
  id SERIAL PRIMARY KEY,
  review_product_id VARCHAR(255) NOT NULL,
  review_user_id VARCHAR(255) NOT NULL,
  review_rating VARCHAR(255) NOT NULL,
  review_comment TEXT NOT NULL,
  review_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  review_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_review_details_modtime ON review_details;
CREATE TRIGGER update_review_details_modtime
BEFORE UPDATE ON review_details
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE review_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON review_details;
CREATE POLICY "Allow anon/authenticated operations" ON review_details FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ── 18. FESTIVAL DETAILS TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS festival_details (
  id SERIAL PRIMARY KEY,
  festival_title VARCHAR(255) NOT NULL,
  festival_name VARCHAR(255) NOT NULL,
  festival_description TEXT,
  banner_image TEXT,
  discount_type VARCHAR(50) NOT NULL,
  discount_value NUMERIC NOT NULL,
  festival_start_date TIMESTAMP NOT NULL,
  festival_end_date TIMESTAMP NOT NULL,
  festival_status VARCHAR(50) NOT NULL DEFAULT 'active'
);

-- Enable RLS
ALTER TABLE festival_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON festival_details;
CREATE POLICY "Allow anon/authenticated operations" ON festival_details FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ── 19. FESTIVAL DEAL PRODUCTS TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS festival_deal_products (
  deal_id INTEGER REFERENCES festival_details(id) ON DELETE CASCADE,
  product_id VARCHAR(255) NOT NULL,
  PRIMARY KEY (deal_id, product_id)
);

-- Enable RLS
ALTER TABLE festival_deal_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON festival_deal_products;
CREATE POLICY "Allow anon/authenticated operations" ON festival_deal_products FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ── 20. ENSURE PRODUCTS HAS CATEGORY COLUMN ───────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'moringa';

-- ── 21. CUSTOMER RESTOCK REQUESTS TABLE ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_restock_requests (
  id SERIAL PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  customer_phone VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notified_at TIMESTAMP
);

-- Enable RLS
ALTER TABLE customer_restock_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON customer_restock_requests;
CREATE POLICY "Allow anon/authenticated operations" ON customer_restock_requests FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Grant privileges
GRANT ALL ON customer_restock_requests TO anon, authenticated, service_role;

-- ── 22. RESTOCK PRODUCT FUNCTION ──────────────────────────────────────────────
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

GRANT EXECUTE ON FUNCTION restock_product TO anon, authenticated, service_role;

ALTER TABLE "Contact_details" ADD COLUMN IF NOT EXISTS contact_topic VARCHAR(255);

-- ── 24. FAVORITE DETAILS TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorite_details (
  id SERIAL PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_email, product_id)
);

-- Enable RLS
ALTER TABLE favorite_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON favorite_details;
CREATE POLICY "Allow anon/authenticated operations" ON favorite_details FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Grant privileges
GRANT ALL ON favorite_details TO anon, authenticated, service_role;

-- ── 25. ENSURE USER DETAILS HAS ADDITIONAL ADDRESSES COLUMN ───────────────────
ALTER TABLE "User_details" ADD COLUMN IF NOT EXISTS additional_addresses JSONB DEFAULT '[]';

-- ── 26. SMS ALERT LOGS TABLE ──────────────────────────────────────────────────
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

-- Enable RLS
ALTER TABLE sms_alert_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON sms_alert_logs;
CREATE POLICY "Allow anon/authenticated operations" ON sms_alert_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT ALL ON sms_alert_logs TO anon, authenticated, service_role;

-- ── 27. LOW STOCK TRIGGER FUNCTION ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_low_stock_sms()
RETURNS TRIGGER AS $$
DECLARE
  v_product_name TEXT;
  v_admin_phone TEXT;
  v_recipients TEXT[];
BEGIN
  -- Trigger if stock falls below the threshold (15 units)
  -- Only trigger when stock transitions to below threshold, or if it was null, or if alert was never sent
  IF NEW.total_stock < NEW.low_stock_threshold AND 
     (OLD.total_stock >= NEW.low_stock_threshold OR OLD.total_stock IS NULL OR NEW.alert_sent_at IS NULL) THEN
     
     -- Retrieve product name
     SELECT name INTO v_product_name FROM products WHERE id = NEW.product_id;
     
     -- Get the admin phone number from admin_settings
     SELECT value INTO v_admin_phone FROM admin_settings WHERE key = 'admin_phone' LIMIT 1;
     
     -- Default admin phone fallback if not in settings
     IF v_admin_phone IS NULL OR v_admin_phone = '' THEN
       v_admin_phone := '9876543210';
     END IF;
     
     v_recipients := ARRAY[v_admin_phone];
     
     -- Write to logs
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
  
  -- Reset alert timestamp if stock is replenished
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

GRANT EXECUTE ON FUNCTION trigger_low_stock_sms TO anon, authenticated, service_role;