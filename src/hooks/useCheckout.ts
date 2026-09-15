import { useCallback, useEffect, useState } from "react";
import { useCart } from "@/contexts/cart-context";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { createOrderId } from "@/lib/order-id";
import { loadRazorpayScript, openRazorpayModal } from "@/lib/razorpay";
import type { RazorpaySuccessResponse } from "@/lib/razorpay";
import type { CartItem } from "@/types";

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID as string;

interface VerifiedCustomer {
  customer?: { name?: string; email?: string; contact?: string };
  shipping_address?: {
    line1?: string; line2?: string; city?: string;
    state?: string; country?: string; zipcode?: string;
  };
  amount?: number | null;
}

export interface CheckoutResult {
  orderNumber: string;
  total: number;
}

/**
 * Run the Razorpay 1-click checkout for a given list of cart items.
 *
 * - Preloads the Razorpay SDK on mount so the modal opens instantly.
 * - Talks to the server for an authoritative order + address collection (Magic Checkout).
 * - Persists the order + payment + line items into Supabase once the signature verifies.
 * - Fires the invoice email (fire-and-forget).
 *
 * Callers pass the exact items they want to buy. The cart page passes its current cart;
 * a "Buy Now" button on a product tile passes just that one item and doesn't touch the
 * global cart, so an in-progress cart isn't disturbed by a one-off purchase.
 */
export function useCheckout() {
  const { clearCart } = useCart();
  const { toast } = useToast();
  const [isPaying, setIsPaying] = useState(false);

  useEffect(() => { loadRazorpayScript().catch(() => {}); }, []);

  const runCheckout = useCallback(
    async (items: CartItem[]): Promise<CheckoutResult | null> => {
      if (items.length === 0 || isPaying) return null;

      const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
      setIsPaying(true);

      try {
        await loadRazorpayScript();

        const createRes = await fetch("/.netlify/functions/create-razorpay-order", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Key": import.meta.env.VITE_NETLIFY_KEY || "",
          },
          body: JSON.stringify({
            cartItems: items.map(i => ({ productId: i.id, quantity: i.quantity })),
            currency: "INR",
            receipt: `rcpt_${Date.now()}`,
          }),
        });
        if (!createRes.ok) throw new Error("Could not start payment. Please try again.");

        const orderData = await createRes.json();
        const order_id = orderData.order_id || "";
        const key_id = orderData.key_id || RAZORPAY_KEY_ID || "rzp_test_1DP5mmOlF5G5ag";
        const serverAmount = orderData.amount || Math.round(subtotal * 100);

        const result = await new Promise<CheckoutResult>((resolve, reject) => {
          openRazorpayModal({
            orderId: order_id,
            amount: serverAmount,
            currency: "INR",
            keyId: key_id,
            oneClickCheckout: true,
            onDismiss: () => reject(new Error("Payment cancelled by user.")),
            onFailure: (reason) => reject(new Error(reason || "Payment failed.")),
            onSuccess: async (response: RazorpaySuccessResponse) => {
              try {
                const verifyRes = await fetch("/.netlify/functions/verify-razorpay-payment", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Internal-Key": import.meta.env.VITE_NETLIFY_KEY || "",
                  },
                  body: JSON.stringify({
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                  }),
                });
                if (!verifyRes.ok) throw new Error("Payment verification failed. Contact support.");

                const verified: VerifiedCustomer & { success?: boolean } = await verifyRes.json();
                if (!verified.success) throw new Error("Payment signature mismatch. Contact support.");

                const merged: VerifiedCustomer = {
                  customer: {
                    name: verified.customer?.name,
                    email: verified.customer?.email || response.email,
                    contact: verified.customer?.contact || response.contact,
                  },
                  shipping_address: {
                    ...verified.shipping_address,
                    ...(response.shipping_address || {}),
                  },
                  amount: verified.amount,
                };

                const paidRupees = (verified.amount ?? serverAmount) / 100;
                const txnId = response.razorpay_payment_id || `PAY-${Date.now()}`;
                const orderRefId = await persistOrder(items, txnId, paidRupees, merged);

                fireInvoiceEmails(orderRefId);
                clearCart();

                toast({ title: "Payment successful!", description: `Order ID: ${orderRefId}` });
                resolve({ orderNumber: orderRefId, total: paidRupees });
              } catch (err) {
                reject(err);
              }
            },
          });
        });

        return result;
      } catch (err: any) {
        const msg = err?.message || "An unexpected error occurred.";
        if (!msg.toLowerCase().includes("cancel")) {
          toast({ title: "Payment error", description: msg, variant: "destructive" });
        }
        return null;
      } finally {
        setIsPaying(false);
      }
    },
    [isPaying, clearCart, toast]
  );

  return { runCheckout, isPaying };
}

async function persistOrder(
  items: CartItem[],
  txnId: string,
  verifiedAmount: number,
  verified: VerifiedCustomer,
): Promise<string> {
  const customerEmail = (verified.customer?.email || "").trim();
  const customerName = verified.customer?.name || customerEmail.split("@")[0] || "Guest";
  const customerPhone = verified.customer?.contact || "";
  const s = verified.shipping_address || {};
  const addressLine = [s.line1, s.line2].filter(Boolean).join(", ");

  if (customerEmail) {
    await (supabase.from("User_details") as any).upsert(
      {
        user_email: customerEmail,
        user_name: customerName,
        user_password: "",
        user_phone: customerPhone,
        user_address: addressLine,
        user_city: s.city || "",
        user_state: s.state || "",
        user_zip: s.zipcode || "",
        user_country: s.country || "",
        user_gst: "",
      },
      { onConflict: "user_email" }
    );
  }

  const orderId = createOrderId("website");

  const { error: orderErr } = await (supabase.from("orders") as any).insert({
    id: orderId,
    order_number: orderId,
    user_id: customerEmail,
    status: "processing",
    total_amount: verifiedAmount,
    shipping_address: {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      address: addressLine,
      city: s.city || "",
      state: s.state || "",
      zip: s.zipcode || "",
      country: s.country || "",
      source: "website-1cc",
    },
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    customer_address: addressLine,
    customer_city: s.city || "",
    customer_state: s.state || "",
    customer_zip: s.zipcode || "",
    customer_country: s.country || "",
    customer_gst: "",
    coupon_code: null,
    discount_amount: 0,
  });
  if (orderErr) throw orderErr;

  const orderItemRows = await Promise.all(
    items.map(async (item) => {
      let validProductId = item.id;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id);
      if (!isUuid) {
        const { data: prod } = await (supabase.from("products") as any)
          .select("id")
          .or(`slug.eq.${item.id},name.ilike.%${item.name || item.id}%`)
          .maybeSingle();
        if (prod?.id) validProductId = prod.id;
      }
      return {
        order_id: orderId,
        product_id: validProductId,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.price * item.quantity,
      };
    })
  );

  const { error: itemsErr } = await (supabase.from("order_items") as any).insert(orderItemRows);
  if (itemsErr) console.error("order_items insert error:", itemsErr);

  await (supabase.from("Payments") as any).insert({
    payment_order_id: orderId,
    payment_amount: String(verifiedAmount),
    payment_status: "completed",
    payment_method: "RAZORPAY",
    payment_transaction_id: txnId,
  });

  await (supabase.from("Order_history") as any).insert({
    order_id: orderId,
    order_status: "processing",
  });

  return orderId;
}

function fireInvoiceEmails(orderReferenceId: string) {
  try {
    fetch("/.netlify/functions/send-invoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": import.meta.env.VITE_NETLIFY_KEY || "",
      },
      body: JSON.stringify({ orderId: orderReferenceId }),
    }).catch(() => {});

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (supabaseUrl && supabaseKey) {
      fetch(`${supabaseUrl}/functions/v1/send-invoice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ orderId: orderReferenceId }),
      }).catch(() => {});
    }
  } catch (e) {
    console.error("Error triggering invoice email:", e);
  }
}
