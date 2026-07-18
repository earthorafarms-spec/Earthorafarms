-- =============================================================================
-- Migration: Secure Admin RLS Policies
-- Requires matching x-admin-password header inside postgres requests.
-- =============================================================================

-- 1. Helper function to check if request contains valid admin password header
CREATE OR REPLACE FUNCTION verify_admin_header()
RETURNS BOOLEAN SECURITY DEFINER LANGUAGE plpgsql AS $$
DECLARE
  passed_pwd TEXT;
  actual_pwd TEXT;
BEGIN
  -- Extract header
  passed_pwd := coalesce(current_setting('request.headers', true)::json->>'x-admin-password', '');
  IF passed_pwd = '' THEN
    RETURN FALSE;
  END IF;

  -- Get actual password from admin_settings
  SELECT value INTO actual_pwd FROM admin_settings WHERE key = 'admin_password';
  
  RETURN passed_pwd = actual_pwd;
END;
$$;

-- 2. Clean up previous anonymous open-ended policies
DROP POLICY IF EXISTS "Admin all products" ON products;
DROP POLICY IF EXISTS "Admin all inventory" ON inventory;
DROP POLICY IF EXISTS "Admin all orders" ON orders;
DROP POLICY IF EXISTS "Admin all order_items" ON order_items;
DROP POLICY IF EXISTS "Admin all coupons" ON coupons;

-- 3. Re-create secure admin policies utilizing verify_admin_header()
CREATE POLICY "Admin all products" ON products
  FOR ALL USING (verify_admin_header()) WITH CHECK (verify_admin_header());

CREATE POLICY "Admin all inventory" ON inventory
  FOR ALL USING (verify_admin_header()) WITH CHECK (verify_admin_header());

CREATE POLICY "Admin all orders" ON orders
  FOR ALL USING (verify_admin_header()) WITH CHECK (verify_admin_header());

CREATE POLICY "Admin all order_items" ON order_items
  FOR ALL USING (verify_admin_header()) WITH CHECK (verify_admin_header());

CREATE POLICY "Admin all coupons" ON coupons
  FOR ALL USING (verify_admin_header()) WITH CHECK (verify_admin_header());
