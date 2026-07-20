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

-- ── 3. COUPONS TABLE ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('percentage','fixed')),
  value NUMERIC(10,2) NOT NULL,
  min_order NUMERIC(10,2) DEFAULT 0,
  max_uses INTEGER,
  used_count INTEGER DEFAULT 0,
  expiry_date DATE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

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

-- Seed default passwords
INSERT INTO admin_settings (key, value) VALUES 
('admin_password', 'Kai_2828'),
('codex_password', 'Kai_2828')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ── 12. otp_codes TABLE ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
    id SERIAL PRIMARY KEY,
    otp VARCHAR(6) NOT NULL,
    domain VARCHAR(50) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

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
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cart_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Admin_analytics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON products;
CREATE POLICY "Allow anon/authenticated operations" ON products FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON inventory;
CREATE POLICY "Allow anon/authenticated operations" ON inventory FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON coupons;
CREATE POLICY "Allow anon/authenticated operations" ON coupons FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

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
CREATE POLICY "Allow anon/authenticated operations" ON admin_settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon/authenticated operations" ON otp_codes;
CREATE POLICY "Allow anon/authenticated operations" ON otp_codes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

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