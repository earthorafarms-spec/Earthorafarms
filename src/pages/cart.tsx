import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import { Trash2, Minus, Plus, ShoppingBag, ArrowUpRight, Loader2, Shield, CheckCircle2 } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/cart-context";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { createOrderId } from "@/lib/order-id";
import { loadRazorpayScript, openRazorpayModal } from "@/lib/razorpay";
import type { RazorpaySuccessResponse } from "@/lib/razorpay";

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID as string;

interface VerifiedCustomer {
  customer?: { name?: string; email?: string; contact?: string };
  shipping_address?: {
    line1?: string; line2?: string; city?: string;
    state?: string; country?: string; zipcode?: string;
  };
  amount?: number | null;
}

export default function Cart() {
  const { items, removeFromCart, updateQuantity, clearCart, cartCount } = useCart();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [isPaying, setIsPaying] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<{ order_number: string; total: number } | null>(null);

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // Preload the Razorpay SDK so 1-click is truly one click when the user is ready
  useEffect(() => { loadRazorpayScript().catch(() => {}); }, []);

  const persistOrder = async (
    txnId: string,
    verifiedAmount: number,
    verified: VerifiedCustomer,
  ) => {
    const customerEmail = (verified.customer?.email || "").trim();
    const customerName  = verified.customer?.name    || customerEmail.split("@")[0] || "Guest";
    const customerPhone = verified.customer?.contact || "";
    const s = verified.shipping_address || {};
    const addressLine   = [s.line1, s.line2].filter(Boolean).join(", ");

    if (customerEmail) {
      await (supabase.from("User_details") as any).upsert(
        {
          user_email:   customerEmail,
          user_name:    customerName,
          user_password:"",
          user_phone:   customerPhone,
          user_address: addressLine,
          user_city:    s.city    || "",
          user_state:   s.state   || "",
          user_zip:     s.zipcode || "",
          user_country: s.country || "",
          user_gst:     "",
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
      customer_name:    customerName,
      customer_email:   customerEmail,
      customer_phone:   customerPhone,
      customer_address: addressLine,
      customer_city:    s.city    || "",
      customer_state:   s.state   || "",
      customer_zip:     s.zipcode || "",
      customer_country: s.country || "",
      customer_gst:     "",
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
  };

  const fireInvoiceEmails = (orderReferenceId: string) => {
    try {
      fetch("/.netlify/functions/send-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Key": import.meta.env.VITE_NETLIFY_KEY || "" },
        body: JSON.stringify({ orderId: orderReferenceId }),
      }).catch(() => {});

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (supabaseUrl && supabaseKey) {
        fetch(`${supabaseUrl}/functions/v1/send-invoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify({ orderId: orderReferenceId }),
        }).catch(() => {});
      }
    } catch (e) {
      console.error("Error triggering invoice email:", e);
    }
  };

  const handleBuyNow = async () => {
    if (items.length === 0 || isPaying) return;

    setIsPaying(true);

    try {
      await loadRazorpayScript();

      // 1. Ask server for an authoritative Razorpay 1CC order
      const createRes = await fetch("/.netlify/functions/create-razorpay-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Key": import.meta.env.VITE_NETLIFY_KEY || "" },
        body: JSON.stringify({
          cartItems: items.map(i => ({ productId: i.id, quantity: i.quantity })),
          currency: "INR",
          receipt: `rcpt_${Date.now()}`,
        }),
      });

      if (!createRes.ok) {
        throw new Error("Could not start payment. Please try again.");
      }

      const orderData = await createRes.json();
      const order_id     = orderData.order_id || "";
      const key_id       = orderData.key_id  || RAZORPAY_KEY_ID || "rzp_test_1DP5mmOlF5G5ag";
      const serverAmount = orderData.amount   || Math.round(subtotal * 100);

      // 2. Open Razorpay Magic Checkout — address + payment in a single modal
      await new Promise<void>((resolve, reject) => {
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
              // 3. Verify signature + pull shipping/customer from Razorpay
              const verifyRes = await fetch("/.netlify/functions/verify-razorpay-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Internal-Key": import.meta.env.VITE_NETLIFY_KEY || "" },
                body: JSON.stringify({
                  razorpay_order_id:   response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature:  response.razorpay_signature,
                }),
              });

              if (!verifyRes.ok) throw new Error("Payment verification failed. Contact support.");

              const verified: VerifiedCustomer & { success?: boolean } = await verifyRes.json();
              if (!verified.success) throw new Error("Payment signature mismatch. Contact support.");

              // Prefer Razorpay's echoed address in the handler payload, fall back to server-fetched
              const merged: VerifiedCustomer = {
                customer: {
                  name:    verified.customer?.name,
                  email:   verified.customer?.email  || response.email,
                  contact: verified.customer?.contact || response.contact,
                },
                shipping_address: {
                  ...verified.shipping_address,
                  ...(response.shipping_address || {}),
                },
                amount: verified.amount,
              };

              const paidRupees  = (verified.amount ?? serverAmount) / 100;
              const txnId       = response.razorpay_payment_id || `PAY-${Date.now()}`;
              const orderRefId  = await persistOrder(txnId, paidRupees, merged);

              fireInvoiceEmails(orderRefId);

              clearCart();
              setOrderSuccess({ order_number: orderRefId, total: paidRupees });
              toast({ title: "Payment successful!", description: `Order ID: ${orderRefId}` });
              resolve();
            } catch (err) {
              reject(err);
            }
          },
        });
      });
    } catch (err: any) {
      const msg = err?.message || "An unexpected error occurred.";
      if (!msg.toLowerCase().includes("cancel")) {
        toast({ title: "Payment error", description: msg, variant: "destructive" });
      }
    } finally {
      setIsPaying(false);
    }
  };

  // ─────────────────────────────────────────────── Success ───
  if (orderSuccess) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black">
        <Navbar />
        <section className="flex-grow flex items-center justify-center pt-36 pb-20">
          <div className="max-w-md w-full mx-auto px-6 text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-8 h-8 text-emerald-700" />
            </div>
            <h1 className="text-3xl font-serif mb-2">Thank you for your order!</h1>
            <p className="text-sm text-black/50 mb-6">Order #{orderSuccess.order_number}</p>
            <div className="bg-[#FEFDF9] rounded-xl p-5 border border-black/5 text-left mb-8">
              <div className="flex justify-between text-xs text-black/60">
                <span>Payment method:</span>
                <span className="font-semibold text-black">Razorpay 1-click</span>
              </div>
              <div className="flex justify-between text-xs text-black/60 border-t border-black/10 pt-2 mt-2">
                <span>Total amount:</span>
                <span className="font-bold text-black">₹{orderSuccess.total.toFixed(2)}</span>
              </div>
            </div>
            <Button size="lg" className="w-full h-12 text-sm" onClick={() => setLocation("/")}>
              Back to Home
            </Button>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  // ─────────────────────────────────────────────── Empty ───
  if (items.length === 0) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
        <Navbar />
        <section className="relative pt-36 pb-20 lg:pt-44 lg:pb-24 overflow-hidden bg-[#0E0E0E] text-white">
          <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10 text-center">
            <div className="w-16 h-16 rounded-full bg-white/10 text-amber-300 flex items-center justify-center mx-auto mb-6">
              <ShoppingBag className="w-8 h-8" />
            </div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-dm font-normal tracking-[-0.05em] text-[40px] leading-[44px] sm:text-[60px] sm:leading-[56px] text-white mb-4"
            >
              Your cart is empty.
            </motion.h1>
            <p className="font-inter text-base text-white/60 mb-8 max-w-md mx-auto">
              Looks like you haven't added anything yet. Explore our botanical collection to find your daily ritual.
            </p>
            <Link
              href="/our-product"
              className="inline-flex items-center gap-2 bg-white text-black px-8 py-4 rounded-xl font-inter font-medium text-base hover:bg-white/90 transition-colors shadow-xl"
            >
              <span>Shop Collection</span>
              <ArrowUpRight className="w-5 h-5" />
            </Link>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  // ─────────────────────────────────────────────── Main ───
  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
      <Navbar />

      <section className="relative pt-36 pb-16 lg:pt-44 lg:pb-20 overflow-hidden bg-[#0E0E0E] text-white">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="mb-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 font-dm font-medium text-xs sm:text-sm text-white/80 tracking-[0.05em] uppercase">
                <ShoppingBag className="w-3.5 h-3.5 text-amber-300" />
                <span>Your Cart</span>
              </div>
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[44px] leading-[46px] sm:text-[68px] sm:leading-[64px] text-white">
                Review Your Order.
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="font-inter font-normal text-base text-white/55 max-w-[340px]"
            >
              {cartCount} {cartCount === 1 ? 'item' : 'items'} in your cart. Free shipping applies at checkout.
            </motion.p>
          </div>
        </div>
      </section>

      <section className="flex-1 py-16 lg:py-24">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-start">
            <div className="lg:col-span-8 space-y-4">
              <div className="flex items-center justify-between pb-4 border-b border-black/10 font-inter text-xs text-black/40 uppercase tracking-wider font-medium">
                <span>Product</span>
                <button
                  onClick={clearCart}
                  className="hover:text-black transition-colors"
                >
                  Clear Cart
                </button>
              </div>

              {items.map((item) => (
                <div
                  key={item.id}
                  className="bg-[#FEFDF9] rounded-2xl p-4 sm:p-6 border border-black/5 flex flex-col sm:flex-row sm:items-center justify-between gap-6 shadow-sm"
                >
                  <div className="flex items-center gap-5">
                    <div className="w-20 h-20 rounded-xl bg-[#ECEDEC] overflow-hidden shrink-0 flex items-center justify-center p-2">
                      {item.image ? (
                        <img src={item.image} alt={item.name} className="w-full h-full object-contain" />
                      ) : (
                        <div className="w-full h-full bg-black/5 flex items-center justify-center text-xs text-black/40">No image</div>
                      )}
                    </div>
                    <div>
                      <h3 className="font-dm font-normal text-xl text-black tracking-[-0.02em] mb-1">
                        {item.name}
                      </h3>
                      <span className="font-dm text-lg text-black font-normal">
                        ₹{item.price.toFixed(0)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-6 pt-4 sm:pt-0 border-t sm:border-t-0 border-black/5">
                    <div className="flex items-center border border-black/15 rounded-xl bg-[#FAF9F5] p-1">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-black/60 hover:text-black hover:bg-black/5 transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-10 text-center font-inter text-sm font-medium">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-black/60 hover:text-black hover:bg-black/5 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <span className="font-dm text-xl text-black font-normal min-w-[80px] text-right">
                      ₹{(item.price * item.quantity).toFixed(0)}
                    </span>

                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="p-2 text-black/30 hover:text-rose-600 transition-colors"
                      title="Remove item"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Order Summary — 1-click Buy Now */}
            <div className="lg:col-span-4">
              <div className="bg-[#FEFDF9] rounded-3xl p-8 border border-black/5 shadow-xl sticky top-28">
                <h3 className="font-dm font-normal text-2xl text-black tracking-[-0.03em] mb-6">
                  Order Summary
                </h3>

                <div className="space-y-4 font-inter text-sm mb-6 pb-6 border-b border-black/8">
                  <div className="flex justify-between text-black/60">
                    <span>Subtotal</span>
                    <span className="text-black font-medium">₹{subtotal.toFixed(0)}</span>
                  </div>
                  <div className="flex justify-between text-black/60">
                    <span>Shipping</span>
                    <span className="text-emerald-700 font-medium">Free</span>
                  </div>
                </div>

                <div className="flex justify-between items-baseline mb-6">
                  <span className="font-dm text-xl text-black font-medium">Total</span>
                  <span className="font-dm text-3xl text-black font-normal tracking-[-0.03em]">
                    ₹{subtotal.toFixed(0)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleBuyNow}
                  disabled={isPaying}
                  className="w-full bg-black text-white py-4 rounded-xl font-inter font-medium text-base hover:bg-black/85 transition-colors shadow-lg flex items-center justify-center gap-2 group disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isPaying ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Opening payment…</span>
                    </>
                  ) : (
                    <>
                      <span>Buy Now — 1-click</span>
                      <ArrowUpRight className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    </>
                  )}
                </button>

                <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-black/45">
                  <Shield className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Address &amp; payment collected securely by Razorpay</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
