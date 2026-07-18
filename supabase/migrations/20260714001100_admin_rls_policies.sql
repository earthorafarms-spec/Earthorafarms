-- =============================================================================
-- Migration: Admin panel RLS policies
--
-- The admin panel uses the anon key (no auth session) and is protected by
-- the password-based AdminGate component. These policies grant the anon key
-- full CRUD alongside the existing public-read policies. Supabase OR's
-- policies together, so public reads still work and admin writes also work.
-- =============================================================================

-- PRODUCTS: admin needs full CRUD (public read remains via existing policy)
CREATE POLICY "Admin all products" ON products
  FOR ALL USING (true) WITH CHECK (true);

-- INVENTORY: admin reads/writes stock
CREATE POLICY "Admin all inventory" ON inventory
  FOR ALL USING (true) WITH CHECK (true);

-- ORDERS: admin reads/updates all orders
CREATE POLICY "Admin all orders" ON orders
  FOR ALL USING (true) WITH CHECK (true);

-- ORDER ITEMS: admin reads all order items
CREATE POLICY "Admin all order_items" ON order_items
  FOR ALL USING (true) WITH CHECK (true);

-- COUPONS: admin manages coupons
CREATE POLICY "Admin all coupons" ON coupons
  FOR ALL USING (true) WITH CHECK (true);
