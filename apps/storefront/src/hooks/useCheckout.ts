import { useCallback, useEffect, useState } from "react";
import { useCart } from "@/contexts/cart-context";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/apiClient";
import { loadRazorpayScript, openRazorpayModal } from "@/lib/razorpay";
import type { RazorpaySuccessResponse } from "@/lib/razorpay";
import type { CartItem } from "@/types";

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID as string;

export interface CheckoutResult {
  orderNumber: string;
  total: number;
}

/**
 * Razorpay 1-click checkout.
 * - The server prices the cart and creates the Razorpay order (client amounts are never trusted).
 * - After payment, the server verifies the signature, pulls the collected address from Razorpay and
 *   finalizes the order in one transaction (invoice + admin notification are queued there).
 */
export function useCheckout() {
  const { clearCart } = useCart();
  const { toast } = useToast();
  const [isPaying, setIsPaying] = useState(false);

  useEffect(() => { loadRazorpayScript().catch(() => {}); }, []);

  const runCheckout = useCallback(
    async (items: CartItem[], couponCode?: string | null): Promise<CheckoutResult | null> => {
      if (items.length === 0 || isPaying) return null;
      setIsPaying(true);
      try {
        await loadRazorpayScript();
        const orderData = await api<{ order_id: string; amount: number; currency: string; key_id: string }>("/api/store/checkout/order", {
          method: "POST",
          json: { cartItems: items.map((i) => ({ productId: i.id, quantity: i.quantity })), couponCode: couponCode || null, currency: "INR" },
        });

        const result = await new Promise<CheckoutResult>((resolve, reject) => {
          openRazorpayModal({
            orderId: orderData.order_id,
            amount: orderData.amount,
            currency: "INR",
            keyId: orderData.key_id || RAZORPAY_KEY_ID,
            oneClickCheckout: true,
            onDismiss: () => reject(new Error("Payment cancelled by user.")),
            onFailure: (reason) => reject(new Error(reason || "Payment failed.")),
            onSuccess: async (response: RazorpaySuccessResponse) => {
              try {
                const verified = await api<{ success: boolean; orderId: string; orderNumber: string; amount: number }>("/api/store/checkout/verify", {
                  method: "POST",
                  json: {
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                  },
                });
                if (!verified.success) throw new Error("Payment verification failed. Contact support.");
                clearCart();
                toast({ title: "Payment successful!", description: `Order ID: ${verified.orderNumber}` });
                resolve({ orderNumber: verified.orderNumber, total: verified.amount / 100 });
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
