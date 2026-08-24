-- ===========================================================================
-- EARTHORA FARMS — VOICE AGENT SCHEMA (CONSOLIDATED)
-- File: schema_agent.sql
-- Consolidates:
--   • 20260901000000_voice_agent_schema.sql       (5 agent tables, RLS, grants)
--   • 20260908000000_voice_checkout_finalizer.sql (finalize_voice_order RPC)
-- ---------------------------------------------------------------------------
-- Prerequisites: schema_website.sql must be applied first.
--   This schema references: products, orders, order_items, Payments,
--   Order_history (all defined in schema_website.sql).
-- ---------------------------------------------------------------------------
-- Access model: all tables default-deny anon/authenticated.
-- Only voice-service's service-role client may read/write them.
-- Exception: product_knowledge also accepts anon/authenticated so the
-- password-gated /sun-earthora admin portal can manage it directly
-- (same pattern as coupon_details and festival_details).
-- ===========================================================================

-- ── Generic updated_at trigger for voice agent tables ────────────────────────
CREATE OR REPLACE FUNCTION update_voice_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 1. PRODUCT KNOWLEDGE ─────────────────────────────────────────────────────
-- Admin-curated, versioned facts the voice agent is allowed to speak for
-- benefits/dosage/warnings/etc. Only approved + currently-effective rows
-- are ever retrievable by voice-service.
CREATE TABLE IF NOT EXISTS product_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL CHECK (category IN (
    'description', 'benefits', 'dosage', 'directions', 'ingredients',
    'warnings', 'contraindications', 'storage', 'faq'
  )),
  question TEXT,
  content TEXT NOT NULL,
  locale VARCHAR(10) NOT NULL DEFAULT 'en-IN',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_knowledge_lookup
  ON product_knowledge(product_id, category, status);
CREATE INDEX IF NOT EXISTS idx_product_knowledge_approved
  ON product_knowledge(product_id, category)
  WHERE status = 'approved';
DROP TRIGGER IF EXISTS update_product_knowledge_modtime ON product_knowledge;
CREATE TRIGGER update_product_knowledge_modtime BEFORE UPDATE ON product_knowledge
FOR EACH ROW EXECUTE FUNCTION update_voice_updated_at_column();

-- ── 2. VOICE CALL SESSIONS ───────────────────────────────────────────────────
-- One row per conversation session.
CREATE TABLE IF NOT EXISTS voice_call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(20) NOT NULL DEFAULT 'browser' CHECK (provider IN ('browser', 'tata_smartflo')),
  provider_call_id TEXT UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'started' CHECK (status IN (
    'started', 'discovering', 'cart_building', 'collecting_checkout',
    'checkout_ready', 'link_sent', 'ended',
    'handoff_unavailable', 'abandoned', 'failed'
  )),
  locale VARCHAR(10) NOT NULL DEFAULT 'en-IN',
  caller_phone_encrypted TEXT,
  conversation_state JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_call_sessions_status ON voice_call_sessions(status);
DROP TRIGGER IF EXISTS update_voice_call_sessions_modtime ON voice_call_sessions;
CREATE TRIGGER update_voice_call_sessions_modtime BEFORE UPDATE ON voice_call_sessions
FOR EACH ROW EXECUTE FUNCTION update_voice_updated_at_column();

-- ── 3. VOICE CHECKOUT SESSIONS ───────────────────────────────────────────────
-- Draft cart + shipping info + pricing snapshot for one voice-initiated
-- checkout attempt. order_id is set only by finalize_voice_order after a
-- verified Razorpay payment.
CREATE TABLE IF NOT EXISTS voice_checkout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_session_id UUID NOT NULL REFERENCES voice_call_sessions(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'link_sent', 'opened', 'verified', 'repriced',
    'payment_link_created', 'payment_confirmed', 'finalizing', 'order_created',
    'expired', 'abandoned', 'payment_failed', 'finalization_failed'
  )),

  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'India',
  gst TEXT,
  coupon_code TEXT,
  marketing_consent BOOLEAN NOT NULL DEFAULT false,

  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  provisional_subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  provisional_discount NUMERIC(10,2) NOT NULL DEFAULT 0,
  provisional_tax NUMERIC(10,2) NOT NULL DEFAULT 0,
  provisional_shipping NUMERIC(10,2) NOT NULL DEFAULT 0,
  provisional_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  frozen_pricing JSONB,

  -- SHA-256 hex digest of the raw token. The raw token is never stored —
  -- only ever appears in the emailed URL.
  verification_token_hash TEXT NOT NULL UNIQUE,
  token_expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  pricing_frozen_at TIMESTAMPTZ,

  razorpay_payment_link_id TEXT UNIQUE,
  razorpay_reference_id TEXT UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  payment_status VARCHAR(20),

  order_id VARCHAR(255) UNIQUE REFERENCES orders(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_checkout_sessions_call_session
  ON voice_checkout_sessions(call_session_id);
CREATE INDEX IF NOT EXISTS idx_voice_checkout_sessions_status
  ON voice_checkout_sessions(status);
DROP TRIGGER IF EXISTS update_voice_checkout_sessions_modtime ON voice_checkout_sessions;
CREATE TRIGGER update_voice_checkout_sessions_modtime BEFORE UPDATE ON voice_checkout_sessions
FOR EACH ROW EXECUTE FUNCTION update_voice_updated_at_column();

-- ── 4. VOICE CHECKOUT ITEMS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_checkout_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id UUID NOT NULL REFERENCES voice_checkout_sessions(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  provisional_unit_price NUMERIC(10,2) NOT NULL,
  frozen_unit_price NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(checkout_session_id, product_id)
);
DROP TRIGGER IF EXISTS update_voice_checkout_items_modtime ON voice_checkout_items;
CREATE TRIGGER update_voice_checkout_items_modtime BEFORE UPDATE ON voice_checkout_items
FOR EACH ROW EXECUTE FUNCTION update_voice_updated_at_column();

-- ── 5. PAYMENT WEBHOOK EVENTS ────────────────────────────────────────────────
-- Durable idempotency inbox. Every inbound Razorpay webhook delivery is
-- recorded here BEFORE processing; a UNIQUE violation on provider_event_id
-- short-circuits duplicate/retried deliveries.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(20) NOT NULL DEFAULT 'razorpay',
  provider_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  payload JSONB NOT NULL,
  processing_status VARCHAR(20) NOT NULL DEFAULT 'received' CHECK (processing_status IN (
    'received', 'processed', 'failed', 'ignored'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_status
  ON payment_webhook_events(processing_status);

-- ===========================================================================
-- ROW LEVEL SECURITY — default-deny anon/authenticated on all 5 tables.
-- Only voice-service's service-role client may read/write these.
-- ===========================================================================
ALTER TABLE product_knowledge         ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_call_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_checkout_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_checkout_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhook_events    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service manage product_knowledge" ON product_knowledge;
CREATE POLICY "Service manage product_knowledge" ON product_knowledge FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage voice_call_sessions" ON voice_call_sessions;
CREATE POLICY "Service manage voice_call_sessions" ON voice_call_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage voice_checkout_sessions" ON voice_checkout_sessions;
CREATE POLICY "Service manage voice_checkout_sessions" ON voice_checkout_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage voice_checkout_items" ON voice_checkout_items;
CREATE POLICY "Service manage voice_checkout_items" ON voice_checkout_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage payment_webhook_events" ON payment_webhook_events;
CREATE POLICY "Service manage payment_webhook_events" ON payment_webhook_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Deliberate, scoped exception: product_knowledge is managed directly from
-- the browser via the /sun-earthora admin portal (anon key + Gate), matching
-- how coupon_details and festival_details work. No other table here gets this.
DROP POLICY IF EXISTS "Admin read product_knowledge" ON product_knowledge;
CREATE POLICY "Admin read product_knowledge" ON product_knowledge FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admin write product_knowledge" ON product_knowledge;
CREATE POLICY "Admin write product_knowledge" ON product_knowledge FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Admin update product_knowledge" ON product_knowledge;
CREATE POLICY "Admin update product_knowledge" ON product_knowledge FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin delete product_knowledge" ON product_knowledge;
CREATE POLICY "Admin delete product_knowledge" ON product_knowledge FOR DELETE TO anon, authenticated USING (true);

-- ===========================================================================
-- GRANTS
-- ===========================================================================
GRANT ALL ON product_knowledge, voice_call_sessions, voice_checkout_sessions,
  voice_checkout_items, payment_webhook_events TO service_role;

-- product_knowledge: matches coupon_details/festival_details access shape for admin portal.
GRANT SELECT, INSERT, UPDATE, DELETE ON product_knowledge TO anon, authenticated;

-- Explicitly revoke anon/authenticated from the other 4 tables — RLS already
-- denies them; this is defense-in-depth documentation of intent.
REVOKE ALL ON voice_call_sessions, voice_checkout_sessions,
  voice_checkout_items, payment_webhook_events FROM anon, authenticated;

-- ===========================================================================
-- VOICE ORDER FINALIZER RPC (Phase 4)
-- ---------------------------------------------------------------------------
-- The ONLY code path allowed to write a voice order into the real
-- orders/order_items/Payments/Order_history tables. Called exclusively from
-- voice-service after a signature-verified Razorpay webhook.
--
-- Idempotency layers:
--   1. payment_webhook_events.provider_event_id UNIQUE — catches retried
--      webhook deliveries before this function is even called.
--   2. FOR UPDATE lock + order_id IS NOT NULL early-return — concurrent
--      calls for the same session collapse into "return existing order".
--   3. razorpay_payment_link_id/reference_id/payment_id UNIQUE — guards
--      against one payment attaching to two sessions.
--   4. Amount/currency assertion — the actual payment-integrity check.
-- ===========================================================================
CREATE OR REPLACE FUNCTION finalize_voice_order(
  p_checkout_session_id UUID,
  p_razorpay_payment_id VARCHAR,
  p_paid_amount NUMERIC,
  p_paid_currency VARCHAR
) RETURNS VARCHAR AS $$
DECLARE
  v_session voice_checkout_sessions%ROWTYPE;
  v_order_id VARCHAR(255);
  v_shipping_address JSONB;
BEGIN
  -- Lock the row for the duration of this transaction so a concurrent
  -- (e.g. retried) call for the same session cannot race.
  SELECT * INTO v_session FROM voice_checkout_sessions
    WHERE id = p_checkout_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No voice_checkout_sessions row for %', p_checkout_session_id;
  END IF;

  IF v_session.order_id IS NOT NULL THEN
    RETURN v_session.order_id; -- already finalized: idempotent no-op
  END IF;

  IF v_session.frozen_pricing IS NULL THEN
    RAISE EXCEPTION 'Cannot finalize: pricing was never frozen for %', p_checkout_session_id;
  END IF;

  IF round((v_session.frozen_pricing->>'total')::numeric, 2) <> round(p_paid_amount, 2)
     OR v_session.currency <> p_paid_currency THEN
    RAISE EXCEPTION 'Amount/currency mismatch for %: expected % %, got % %',
      p_checkout_session_id, v_session.frozen_pricing->>'total', v_session.currency,
      p_paid_amount, p_paid_currency;
  END IF;

  v_order_id := 'ORD-' || floor(extract(epoch from now()) * 1000)::text
              || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  v_shipping_address := jsonb_build_object(
    'name', v_session.name, 'email', v_session.email, 'phone', v_session.phone,
    'address', v_session.address, 'city', v_session.city, 'state', v_session.state,
    'zip', v_session.postal_code, 'country', v_session.country, 'gst', coalesce(v_session.gst, ''),
    'source', 'voice_agent'
  );

  INSERT INTO orders (
    id, order_number, user_id, status, total_amount, shipping_address,
    customer_name, customer_email, customer_phone, customer_address, customer_city,
    customer_state, customer_zip, customer_country, customer_gst
  ) VALUES (
    v_order_id, v_order_id, coalesce(nullif(v_session.email, ''), 'voice:' || v_session.id::text),
    'pending', p_paid_amount, v_shipping_address,
    v_session.name, v_session.email, v_session.phone, v_session.address, v_session.city,
    v_session.state, v_session.postal_code, v_session.country, coalesce(v_session.gst, '')
  );

  -- Fires the existing reduce_stock_on_order_item trigger automatically —
  -- do not deduct stock again here.
  INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price)
  SELECT v_order_id, product_id, quantity,
         coalesce(frozen_unit_price, provisional_unit_price),
         coalesce(frozen_unit_price, provisional_unit_price) * quantity
  FROM voice_checkout_items
  WHERE checkout_session_id = p_checkout_session_id;

  INSERT INTO "Payments" (payment_order_id, payment_amount, payment_status, payment_method, payment_transaction_id)
  VALUES (v_order_id, p_paid_amount::text, 'completed', 'RAZORPAY', p_razorpay_payment_id);

  -- Fires the existing sync_order_status_trigger, which sets orders.status —
  -- do not UPDATE orders.status directly.
  INSERT INTO "Order_history" (order_id, order_status) VALUES (v_order_id, 'pending');

  UPDATE voice_checkout_sessions
    SET order_id = v_order_id,
        status = 'order_created',
        payment_status = 'paid',
        razorpay_payment_id = p_razorpay_payment_id
    WHERE id = p_checkout_session_id;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION finalize_voice_order FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION finalize_voice_order TO service_role;
