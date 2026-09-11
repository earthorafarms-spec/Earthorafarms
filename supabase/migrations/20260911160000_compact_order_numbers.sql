-- Backfill customer-facing order references without changing the primary-key
-- IDs used by payments, order items, invoices, and tracking URLs.
UPDATE public.orders
SET order_number =
  CASE
    WHEN lower(COALESCE(shipping_address->>'source', '')) LIKE '%whatsapp%'
      OR lower(COALESCE(user_id, '')) LIKE 'whatsapp:%' THEN 'WA'
    WHEN lower(COALESCE(shipping_address->>'source', '')) LIKE '%voice%'
      OR lower(COALESCE(shipping_address->>'source', '')) LIKE '%smartflo%' THEN 'VA'
    WHEN lower(COALESCE(shipping_address->>'source', '')) LIKE '%offline%'
      OR lower(COALESCE(shipping_address->>'source', '')) LIKE '%manual%' THEN 'OFF'
    ELSE 'WEB'
  END || '-' || upper(substr(md5(id), 1, 10))
WHERE order_number IS NULL
   OR order_number NOT LIKE 'WEB-%'
  AND order_number NOT LIKE 'OFF-%'
  AND order_number NOT LIKE 'VA-%'
  AND order_number NOT LIKE 'WA-%';

