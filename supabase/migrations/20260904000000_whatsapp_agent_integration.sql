-- Apply AFTER schema_website.sql and schema_agent.sql, before deploying the agent.
-- Additive: does not drop orders, catalog, knowledge or existing payment history.
BEGIN;

ALTER TABLE public."Payments" ADD COLUMN IF NOT EXISTS payment_context JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.whatsapp_agent_sessions (
  phone_number TEXT PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE,
  session_data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_agent_sessions_expiry ON public.whatsapp_agent_sessions(expires_at);
CREATE TABLE IF NOT EXISTS public.whatsapp_agent_locks (
  phone_number TEXT PRIMARY KEY,
  owner UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.whatsapp_agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_agent_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_agent_sessions, public.whatsapp_agent_locks FROM anon, authenticated;
GRANT ALL ON public.whatsapp_agent_sessions, public.whatsapp_agent_locks TO service_role;

CREATE OR REPLACE FUNCTION public.save_whatsapp_agent_session(
  p_phone TEXT, p_session_id UUID, p_data JSONB, p_expires_at TIMESTAMPTZ
) RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  DELETE FROM whatsapp_agent_sessions WHERE expires_at < now();
  INSERT INTO whatsapp_agent_sessions(phone_number, session_id, session_data, expires_at)
  VALUES(p_phone, p_session_id, p_data, p_expires_at)
  ON CONFLICT(phone_number) DO UPDATE SET session_id = EXCLUDED.session_id,
    session_data = EXCLUDED.session_data, expires_at = EXCLUDED.expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_whatsapp_agent_lock(p_phone TEXT, p_owner UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path = public AS $$
DECLARE acquired TEXT;
BEGIN
  INSERT INTO whatsapp_agent_locks(phone_number, owner, expires_at)
  VALUES(p_phone, p_owner, now() + interval '3 minutes')
  ON CONFLICT(phone_number) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
    WHERE whatsapp_agent_locks.expires_at < now()
  RETURNING phone_number INTO acquired;
  RETURN acquired IS NOT NULL;
END;
$$;

-- Atomic header + line items. A payment reference is serialized across workers;
-- duplicate order creation raises 23505, handled by CreateOrderUseCase's lookup.
CREATE OR REPLACE FUNCTION public.save_whatsapp_agent_order(p_order JSONB, p_items JSONB)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  order_key TEXT := p_order->>'id';
  consent_key TEXT := p_order->'shipping_address'->>'idempotency_key';
  other_id TEXT;
BEGIN
  IF order_key IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order ID and non-empty items required' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NULLIF(consent_key, ''), order_key), 0));
  IF NULLIF(consent_key, '') IS NOT NULL THEN
    SELECT id INTO other_id FROM orders
      WHERE shipping_address->>'idempotency_key' = consent_key AND id <> order_key LIMIT 1;
    IF other_id IS NOT NULL THEN
      RAISE EXCEPTION 'Checkout already materialized' USING ERRCODE = '23505';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) item
      WHERE item->>'order_id' IS DISTINCT FROM order_key OR (item->>'quantity')::INTEGER <= 0) THEN
    RAISE EXCEPTION 'Invalid order items' USING ERRCODE = '23514';
  END IF;
  INSERT INTO orders(id, order_number, user_id, status, total_amount, shipping_address,
    customer_name, customer_email, customer_phone, customer_address, customer_city,
    customer_state, customer_zip, customer_country, customer_gst, created_at)
  VALUES(order_key, p_order->>'order_number', p_order->>'user_id', p_order->>'status',
    (p_order->>'total_amount')::NUMERIC, p_order->'shipping_address',
    p_order->>'customer_name', p_order->>'customer_email', p_order->>'customer_phone',
    p_order->>'customer_address', p_order->>'customer_city', p_order->>'customer_state',
    p_order->>'customer_zip', p_order->>'customer_country', p_order->>'customer_gst',
    (p_order->>'created_at')::TIMESTAMPTZ)
  ON CONFLICT(id) DO UPDATE SET status = EXCLUDED.status, total_amount = EXCLUDED.total_amount,
    shipping_address = EXCLUDED.shipping_address,
    customer_name = EXCLUDED.customer_name, customer_email = EXCLUDED.customer_email,
    customer_phone = EXCLUDED.customer_phone, customer_address = EXCLUDED.customer_address,
    customer_city = EXCLUDED.customer_city, customer_state = EXCLUDED.customer_state,
    customer_zip = EXCLUDED.customer_zip, customer_country = EXCLUDED.customer_country,
    customer_gst = EXCLUDED.customer_gst;
  DELETE FROM order_items WHERE order_id = order_key;
  INSERT INTO order_items(order_id, product_id, quantity, unit_price, total_price, created_at)
  SELECT order_key, (item->>'product_id')::UUID, (item->>'quantity')::INTEGER,
    (item->>'unit_price')::NUMERIC, (item->>'total_price')::NUMERIC,
    (item->>'created_at')::TIMESTAMPTZ FROM jsonb_array_elements(p_items) item;
END;
$$;

REVOKE ALL ON FUNCTION public.save_whatsapp_agent_session(TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_whatsapp_agent_lock(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_whatsapp_agent_order(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_whatsapp_agent_session(TEXT, UUID, JSONB, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_whatsapp_agent_lock(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_whatsapp_agent_order(JSONB, JSONB) TO service_role;

-- Read-only deployment readiness probe; missing migration/credentials fail health.
CREATE OR REPLACE FUNCTION public.whatsapp_agent_schema_version()
RETURNS INTEGER LANGUAGE sql SET search_path = public AS $$ SELECT 1; $$;
REVOKE ALL ON FUNCTION public.whatsapp_agent_schema_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_agent_schema_version() TO service_role;

-- Knowledge editing is an admin operation. Browser writes must go through the
-- verified admin Edge Function/service role, never the public anon key.
DROP POLICY IF EXISTS "Admin write product_knowledge" ON public.product_knowledge;
DROP POLICY IF EXISTS "Admin update product_knowledge" ON public.product_knowledge;
DROP POLICY IF EXISTS "Admin delete product_knowledge" ON public.product_knowledge;
REVOKE INSERT, UPDATE, DELETE ON public.product_knowledge FROM anon, authenticated;

COMMIT;
