-- Migration: Automated Inventory Stock Deduction & Restoration Triggers
-- Date: 2026-08-13

-- 1. Trigger function: Decrement total_stock when an order item is inserted
CREATE OR REPLACE FUNCTION reduce_stock_on_order_item()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory
  SET total_stock = GREATEST(0, total_stock - NEW.quantity),
      updated_at = NOW()
  WHERE product_id = NEW.product_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_reduce_stock_on_order_item ON order_items;
CREATE TRIGGER trigger_reduce_stock_on_order_item
AFTER INSERT ON order_items
FOR EACH ROW
EXECUTE FUNCTION reduce_stock_on_order_item();

-- 2. Trigger function: Restore stock if an order is cancelled, or re-deduct if un-cancelled
CREATE OR REPLACE FUNCTION handle_order_cancellation_stock()
RETURNS TRIGGER AS $$
DECLARE
  item RECORD;
BEGIN
  -- If order status changed to 'cancelled' from another status
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    FOR item IN SELECT product_id, quantity FROM order_items WHERE order_id = NEW.id LOOP
      UPDATE inventory
      SET total_stock = total_stock + item.quantity,
          updated_at = NOW()
      WHERE product_id = item.product_id;
    END LOOP;
  -- If order status changed FROM 'cancelled' back to an active status
  ELSIF OLD.status = 'cancelled' AND NEW.status != 'cancelled' THEN
    FOR item IN SELECT product_id, quantity FROM order_items WHERE order_id = NEW.id LOOP
      UPDATE inventory
      SET total_stock = GREATEST(0, total_stock - item.quantity),
          updated_at = NOW()
      WHERE product_id = item.product_id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_handle_order_cancellation_stock ON orders;
CREATE TRIGGER trigger_handle_order_cancellation_stock
AFTER UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION handle_order_cancellation_stock();

-- 3. Trigger function: Restore stock if an order item is deleted
CREATE OR REPLACE FUNCTION restore_stock_on_order_item_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory
  SET total_stock = total_stock + OLD.quantity,
      updated_at = NOW()
  WHERE product_id = OLD.product_id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_restore_stock_on_order_item_delete ON order_items;
CREATE TRIGGER trigger_restore_stock_on_order_item_delete
AFTER DELETE ON order_items
FOR EACH ROW
EXECUTE FUNCTION restore_stock_on_order_item_delete();

-- Grant Execution Permissions
GRANT EXECUTE ON FUNCTION reduce_stock_on_order_item       TO service_role, anon, authenticated;
GRANT EXECUTE ON FUNCTION handle_order_cancellation_stock TO service_role, anon, authenticated;
GRANT EXECUTE ON FUNCTION restore_stock_on_order_item_delete TO service_role, anon, authenticated;
