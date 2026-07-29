-- ═══════════════════════════════════════════════════════════════════════════
-- EARTHORA FARMS — VOICE AGENT SCHEMA & EXPIRY CLEANUP FUNCTION
-- File: 03_voice_agent.sql
-- Description: Telephony call sessions, voice orders, grounded knowledge base, RLS policies, grants, and auto-expiry logic.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. EXTEND GLOBAL TRIGGER FUNCTION FOR NEW TABLES ──────────────────────────
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
   ELSIF TG_TABLE_NAME = 'knowledge_base' THEN
      NEW.updated_at = NOW();
   ELSIF TG_TABLE_NAME = 'voice_orders' THEN
      NEW.updated_at = NOW();
   END IF;
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 2. CALL SESSIONS TABLE ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_phone TEXT NOT NULL,
  language TEXT CHECK (language IN ('en','hi','gu')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  transcript JSONB DEFAULT '[]'::jsonb, -- array of {role, text, timestamp}
  matched_user_email TEXT REFERENCES "User_details"(user_email) ON DELETE SET NULL,
  outcome TEXT CHECK (outcome IN ('order_placed','order_modified','order_cancelled','status_checked','faq_answered','abandoned','transferred')),
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  ai_provider TEXT CHECK (ai_provider IN ('sarvam','local')), -- tracks which stack handled the call
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 3. VOICE ORDERS TABLE ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
  payment_link_url TEXT,
  payment_link_id TEXT, -- Razorpay payment link id
  payment_status TEXT DEFAULT 'pending_payment' CHECK (payment_status IN ('pending_payment','paid','expired','failed','cancelled')),
  sent_via TEXT CHECK (sent_via IN ('sms','whatsapp','both')),
  customer_phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours'),
  paid_at TIMESTAMPTZ
);

DROP TRIGGER IF EXISTS update_voice_orders_modtime ON voice_orders;
CREATE TRIGGER update_voice_orders_modtime
BEFORE UPDATE ON voice_orders
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 4. KNOWLEDGE BASE TABLE ───────────────────────────────────────────────────
-- Note: pgvector embeddings can be added here later if dataset grows large.
CREATE TABLE IF NOT EXISTS knowledge_base (
  id SERIAL PRIMARY KEY,
  topic TEXT,
  question TEXT,
  answer TEXT,
  source_page TEXT, -- e.g. '/health-benefits'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS update_knowledge_base_modtime ON knowledge_base;
CREATE TRIGGER update_knowledge_base_modtime
BEFORE UPDATE ON knowledge_base
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 5. CANCEL EXPIRED VOICE ORDERS FUNCTION ──────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_expired_voice_orders()
RETURNS INTEGER AS $$
DECLARE
  v_expired_rec RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_expired_rec IN
    SELECT id, order_id
    FROM voice_orders
    WHERE payment_status = 'pending_payment'
      AND expires_at < NOW()
  LOOP
    -- Update payment_status to expired
    UPDATE voice_orders
    SET payment_status = 'expired',
        updated_at = NOW()
    WHERE id = v_expired_rec.id;

    -- Insert cancelled status into Order_history if order_id is present
    -- Existing trigger sync_order_status_trigger on Order_history syncs this to orders.status automatically
    IF v_expired_rec.order_id IS NOT NULL THEN
      INSERT INTO "Order_history" (order_id, order_status, order_notes)
      VALUES (v_expired_rec.order_id, 'cancelled', 'Voice order payment link expired (24h timeout)');
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 6. ROW-LEVEL SECURITY (RLS) POLICIES ─────────────────────────────────────
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

-- Permissive policies for anon, authenticated, service_role (service-role backend access pattern)
DROP POLICY IF EXISTS "Permissive call_sessions policy" ON call_sessions;
CREATE POLICY "Permissive call_sessions policy" ON call_sessions FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permissive voice_orders policy" ON voice_orders;
CREATE POLICY "Permissive voice_orders policy" ON voice_orders FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permissive knowledge_base policy" ON knowledge_base;
CREATE POLICY "Permissive knowledge_base policy" ON knowledge_base FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

-- ── 7. GRANTS & PRIVILEGES ────────────────────────────────────────────────────
GRANT ALL ON TABLE call_sessions TO anon, authenticated, service_role;
GRANT ALL ON TABLE voice_orders TO anon, authenticated, service_role;
GRANT ALL ON TABLE knowledge_base TO anon, authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION cancel_expired_voice_orders() TO service_role;
