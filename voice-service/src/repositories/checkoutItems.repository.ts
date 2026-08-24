import { supabase } from '../lib/supabaseClient.js';

export interface CheckoutItemRow {
  id: string;
  checkoutSessionId: string;
  productId: string;
  quantity: number;
  provisionalUnitPrice: number;
  frozenUnitPrice: number | null;
}

interface DbRow {
  id: string;
  checkout_session_id: string;
  product_id: string;
  quantity: number;
  provisional_unit_price: number;
  frozen_unit_price: number | null;
}

function mapRow(row: DbRow): CheckoutItemRow {
  return {
    id: row.id,
    checkoutSessionId: row.checkout_session_id,
    productId: row.product_id,
    quantity: row.quantity,
    provisionalUnitPrice: Number(row.provisional_unit_price),
    frozenUnitPrice: row.frozen_unit_price === null ? null : Number(row.frozen_unit_price),
  };
}

export async function listCheckoutItems(checkoutSessionId: string): Promise<CheckoutItemRow[]> {
  const { data, error } = await supabase
    .from('voice_checkout_items')
    .select('id, checkout_session_id, product_id, quantity, provisional_unit_price, frozen_unit_price')
    .eq('checkout_session_id', checkoutSessionId);

  if (error) throw error;
  return ((data ?? []) as DbRow[]).map(mapRow);
}

/** Upserts one line's quantity/price — used by add/update cart tools. quantity<=0 deletes the line. */
export async function upsertCheckoutItem(
  checkoutSessionId: string,
  productId: string,
  quantity: number,
  provisionalUnitPrice: number
): Promise<void> {
  if (quantity <= 0) {
    const { error } = await supabase
      .from('voice_checkout_items')
      .delete()
      .eq('checkout_session_id', checkoutSessionId)
      .eq('product_id', productId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('voice_checkout_items')
    .upsert(
      {
        checkout_session_id: checkoutSessionId,
        product_id: productId,
        quantity,
        provisional_unit_price: provisionalUnitPrice,
      },
      { onConflict: 'checkout_session_id,product_id' }
    );
  if (error) throw error;
}

export async function removeCheckoutItem(checkoutSessionId: string, productId: string): Promise<void> {
  const { error } = await supabase
    .from('voice_checkout_items')
    .delete()
    .eq('checkout_session_id', checkoutSessionId)
    .eq('product_id', productId);
  if (error) throw error;
}

/** Freezes unit prices at verify-and-price time — after this, prices in this table are the priced-snapshot source. */
export async function freezeCheckoutItemPrices(
  checkoutSessionId: string,
  pricedLines: { productId: string; unitPrice: number }[]
): Promise<void> {
  for (const line of pricedLines) {
    const { error } = await supabase
      .from('voice_checkout_items')
      .update({ frozen_unit_price: line.unitPrice })
      .eq('checkout_session_id', checkoutSessionId)
      .eq('product_id', line.productId);
    if (error) throw error;
  }
}
