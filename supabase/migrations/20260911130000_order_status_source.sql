-- Keep the admin order workflow aligned across website, voice agent and WhatsApp.
-- New paid orders begin in processing; adding a tracking link moves an active
-- order to out_for_delivery. Delivered orders are never moved backwards.

CREATE OR REPLACE FUNCTION public.finalize_voice_order(
  p_checkout_session_id UUID,
  p_razorpay_payment_id VARCHAR,
  p_paid_amount NUMERIC,
  p_paid_currency VARCHAR
) RETURNS VARCHAR AS $$
DECLARE
  v_session voice_checkout_sessions%ROWTYPE;
  v_order_id VARCHAR(255);
  v_shipping_address JSONB;
  v_source TEXT := 'voice_agent';
BEGIN
  SELECT * INTO v_session FROM voice_checkout_sessions
    WHERE id = p_checkout_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No voice_checkout_sessions row for %', p_checkout_session_id;
  END IF;

  IF v_session.order_id IS NOT NULL THEN
    RETURN v_session.order_id;
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

  SELECT CASE WHEN provider = 'whatsapp' THEN 'whatsapp' ELSE 'voice_agent' END
    INTO v_source
    FROM voice_call_sessions
   WHERE id = v_session.call_session_id;

  v_order_id := 'ORD-' || floor(extract(epoch from now()) * 1000)::text
              || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  v_shipping_address := jsonb_build_object(
    'name', v_session.name, 'email', v_session.email, 'phone', v_session.phone,
    'address', v_session.address, 'city', v_session.city, 'state', v_session.state,
    'zip', v_session.postal_code, 'country', v_session.country, 'gst', coalesce(v_session.gst, ''),
    'source', v_source
  );

  INSERT INTO orders (
    id, order_number, user_id, status, total_amount, shipping_address,
    customer_name, customer_email, customer_phone, customer_address, customer_city,
    customer_state, customer_zip, customer_country, customer_gst
  ) VALUES (
    v_order_id, v_order_id, coalesce(nullif(v_session.email, ''), 'voice:' || v_session.id::text),
    'processing', p_paid_amount, v_shipping_address,
    v_session.name, v_session.email, v_session.phone, v_session.address, v_session.city,
    v_session.state, v_session.postal_code, v_session.country, coalesce(v_session.gst, '')
  );

  INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price)
  SELECT v_order_id, product_id, quantity,
         coalesce(frozen_unit_price, provisional_unit_price),
         coalesce(frozen_unit_price, provisional_unit_price) * quantity
  FROM voice_checkout_items
  WHERE checkout_session_id = p_checkout_session_id;

  INSERT INTO "Payments" (payment_order_id, payment_amount, payment_status, payment_method, payment_transaction_id)
  VALUES (v_order_id, p_paid_amount::text, 'completed', 'RAZORPAY', p_razorpay_payment_id);

  INSERT INTO "Order_history" (order_id, order_status) VALUES (v_order_id, 'processing');

  UPDATE voice_checkout_sessions
     SET order_id = v_order_id,
         status = 'order_created',
         payment_status = 'paid',
         razorpay_payment_id = p_razorpay_payment_id,
         updated_at = now()
   WHERE id = p_checkout_session_id;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Normalize legacy active labels used by earlier website/voice releases while
-- leaving cancelled/refunded records intact for historical reporting.
UPDATE orders
   SET status = CASE
     WHEN lower(status) IN ('shipped', 'packed', 'ready_for_shipment') THEN 'out_for_delivery'
     ELSE 'processing'
   END
 WHERE lower(status) IN ('pending', 'created', 'confirmed', 'shipped', 'packed', 'ready_for_shipment');
