-- Grant privileges on coupon_details, festival_details, and festival_deal_products to authenticated role
GRANT SELECT, INSERT, UPDATE, DELETE ON coupon_details TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON festival_details TO anon, authenticated;
GRANT SELECT, INSERT, DELETE ON festival_deal_products TO anon, authenticated;

-- Update RLS policies for coupon_details
DROP POLICY IF EXISTS "Admin read coupon_details" ON coupon_details;
CREATE POLICY "Admin read coupon_details" ON coupon_details FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admin insert coupon_details" ON coupon_details;
CREATE POLICY "Admin insert coupon_details" ON coupon_details FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Admin update coupon_details" ON coupon_details;
CREATE POLICY "Admin update coupon_details" ON coupon_details FOR UPDATE TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Admin delete coupon_details" ON coupon_details;
CREATE POLICY "Admin delete coupon_details" ON coupon_details FOR DELETE TO anon, authenticated USING (true);
