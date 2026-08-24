import { supabase } from '../lib/supabaseClient.js';

/**
 * The ONLY code path in this entire service allowed to create a real order.
 * Wraps the `finalize_voice_order` RPC (see
 * supabase/migrations/20260908000000_voice_checkout_finalizer.sql), which
 * does the actual atomic insert into orders/order_items/Payments/Order_history
 * inside a single locked plpgsql transaction. This wrapper adds no logic of
 * its own beyond the RPC call — the safety guarantees live in the database
 * function, not here, so that they hold even if two instances of this
 * service call it concurrently.
 */
export async function finalizeVoiceOrder(input: {
  checkoutSessionId: string;
  razorpayPaymentId: string;
  paidAmount: number;
  paidCurrency: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('finalize_voice_order', {
    p_checkout_session_id: input.checkoutSessionId,
    p_razorpay_payment_id: input.razorpayPaymentId,
    p_paid_amount: input.paidAmount,
    p_paid_currency: input.paidCurrency,
  });

  if (error) throw error;
  return data as string; // orders.id
}
