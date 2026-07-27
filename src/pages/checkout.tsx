import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, CreditCard, Shield, Sparkles, CheckCircle2, Ticket, Wallet } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/cart-context";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { openRazorpayModal } from "@/lib/razorpay";
import type { RazorpaySuccessResponse } from "@/lib/razorpay";

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID as string;

export default function Checkout() {
  const [, setLocation] = useLocation();
  const { items, clearCart } = useCart();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");

  // Coupon
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<any | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState("");

  const [paymentMethod, setPaymentMethod] = useState<"cod" | "razorpay">("cod");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<any | null>(null);

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const shippingAmount = 0; // free shipping

  // Auth gate & prefill user data
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      sessionStorage.setItem("post_auth_redirect", "/checkout");
      toast({
        title: "Sign in required",
        description: "Please log in or create an account to proceed to checkout.",
      });
      setLocation("/auth");
      return;
    }

    // Prefill from User_details table
    const emailAddr = user.email;
    (supabase.from("User_details") as any)
      .select("*")
      .eq("user_email", emailAddr)
      .maybeSingle()
      .then(({ data }: { data: Record<string, unknown> | null }) => {
        if (data) {
          setEmail((data.user_email as string) || emailAddr || "");
          setName((data.user_name as string) || user?.user_metadata?.name || "");
          setPhone((data.user_phone as string) || "");
          setAddress((data.user_address as string) || "");
          setCity((data.user_city as string) || "");
          setState((data.user_state as string) || "");
          setPostalCode((data.user_zip as string) || "");
          setCountry((data.user_country as string) || "");
        } else {
          setEmail(emailAddr || "");
          setName(user?.user_metadata?.name || user?.user_metadata?.full_name || "");
          setPhone(user?.phone || "");
        }
      });
  }, [user, authLoading]);

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          <span className="text-sm text-foreground/45">Verifying credentials...</span>
        </div>
      </div>
    );
  }

  // Calculate discount if coupon is applied
  const discountAmount = useMemo(() => {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.type === "percentage") {
      return (subtotal * appliedCoupon.value) / 100;
    } else {
      return Math.min(subtotal, appliedCoupon.value);
    }
  }, [appliedCoupon, subtotal]);

  const totalAmount = Math.max(0, subtotal - discountAmount + shippingAmount);

  // Apply Coupon Code
  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError("");
    try {
      const { data, error } = await (supabase
        .from("coupons") as any)
        .select("*")
        .eq("code", couponCode.trim().toUpperCase())
        .eq("status", "active")
        .single();

      if (error || !data) {
        setCouponError("Invalid or expired coupon code.");
        setAppliedCoupon(null);
        return;
      }

      // Check min order validation
      if (Number(data.min_order) > subtotal) {
        setCouponError(`Minimum order amount of ₹${data.min_order} required.`);
        setAppliedCoupon(null);
        return;
      }

      // Check expiry date
      if (data.expiry_date && new Date(data.expiry_date) < new Date()) {
        setCouponError("This coupon has expired.");
        setAppliedCoupon(null);
        return;
      }

      setAppliedCoupon(data);
      toast({ title: "Coupon Applied!", description: `Discount of ₹${data.value} is applied.` });
    } catch (e: any) {
      setCouponError(e.message || "Failed to validate coupon.");
    } finally {
      setCouponLoading(false);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Save order rows to Supabase and return the first inserted order's ID */
  const saveOrderToDatabase = async (status: string, txnId: string) => {
    // 1. Update user shipping details
    await (supabase.from("User_details") as any)
      .update({
        user_name:    name,
        user_phone:   phone,
        user_address: address,
        user_city:    city,
        user_state:   state,
        user_zip:     postalCode,
        user_country: country,
      })
      .eq("user_email", user?.email);

    // 2. Insert order rows
    const orderRows = items.map((item) => ({
      order_user_id:            user?.email || "",
      order_product_id:         item.id,
      order_product_quantity:   String(item.quantity),
      order_product_price:      String(item.price),
    }));

    const { data: insertedOrders, error: orderInsertErr } = await (supabase.from("Orders") as any)
      .insert(orderRows)
      .select();

    if (orderInsertErr) throw orderInsertErr;

    const orderReferenceId = String(insertedOrders?.[0]?.id || Date.now());

    // 3. Insert payment record
    await (supabase.from("Payments") as any).insert({
      payment_order_id:         orderReferenceId,
      payment_amount:           String(totalAmount),
      payment_status:           status,
      payment_method:           paymentMethod === "cod" ? "COD" : "RAZORPAY",
      payment_transaction_id:   txnId,
    });

    // 4. Insert order history
    await (supabase.from("Order_history") as any).insert({
      order_id:     orderReferenceId,
      order_status: status === "completed" ? "pending" : "cancelled",
    });

    return orderReferenceId;
  };

  // ── COD flow ─────────────────────────────────────────────────────────────────
  const handleCODOrder = async () => {
    const txnId = `COD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const orderReferenceId = await saveOrderToDatabase("completed", txnId);
    setOrderSuccess({ order_number: orderReferenceId, method: "cod", total: totalAmount });
    clearCart();
    toast({ title: "Order placed successfully!", description: `Order ID: ${orderReferenceId}` });
  };

  // ── Razorpay flow ─────────────────────────────────────────────────────────────
  const handleRazorpayOrder = async () => {
    const amountPaise = Math.round(totalAmount * 100);
    if (amountPaise < 100) {
      toast({ title: "Order too small", description: "Minimum order amount is ₹1.", variant: "destructive" });
      return;
    }

    // Step 1: Create Razorpay order via serverless function
    const createRes = await fetch("/.netlify/functions/create-razorpay-order", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        amount:  amountPaise,
        currency: "INR",
        receipt: `rcpt_${Date.now()}`,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({ error: "Failed to initiate payment." }));
      throw new Error(err.error || "Failed to create Razorpay order.");
    }

    const { order_id, amount, currency, key_id } = await createRes.json();

    // Step 2: Open Razorpay modal
    return new Promise<void>((resolve, reject) => {
      openRazorpayModal({
        orderId:  order_id,
        amount,
        currency,
        keyId:    key_id || RAZORPAY_KEY_ID,
        prefill:  { name, email, contact: phone },
        onDismiss: () => {
          reject(new Error("Payment cancelled."));
        },
        onFailure: (reason) => {
          reject(new Error(reason));
        },
        onSuccess: async (response: RazorpaySuccessResponse) => {
          try {
            // Step 3: Verify signature server-side
            const verifyRes = await fetch("/.netlify/functions/verify-razorpay-payment", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
              }),
            });

            if (!verifyRes.ok) {
              throw new Error("Payment verification failed. Please contact support.");
            }

            const { success } = await verifyRes.json();
            if (!success) {
              throw new Error("Payment signature mismatch. Please contact support.");
            }

            // Step 4: Save verified order to DB
            const txnId = response.razorpay_payment_id;
            const orderReferenceId = await saveOrderToDatabase("completed", txnId);
            setOrderSuccess({ order_number: orderReferenceId, method: "razorpay", total: totalAmount });
            clearCart();
            toast({ title: "Payment successful!", description: `Order ID: ${orderReferenceId}` });
            resolve();
          } catch (err: any) {
            reject(err);
          }
        },
      });
    });
  };

  // ── Main submit handler ───────────────────────────────────────────────────────
  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) return;

    if (!name || !email || !phone || !address || !city || !state || !postalCode || !country) {
      toast({ title: "Missing fields", description: "Please fill in all shipping details.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      if (paymentMethod === "cod") {
        await handleCODOrder();
      } else {
        await handleRazorpayOrder();
      }
    } catch (err: any) {
      const msg = err?.message || "An unexpected error occurred.";
      if (msg !== "Payment cancelled.") {
        toast({ title: "Payment error", description: msg, variant: "destructive" });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (orderSuccess) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
        <Navbar />
        <section className="flex-grow flex items-center justify-center pt-36 pb-20">
          <div className="max-w-md w-full mx-auto px-6 text-center">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-serif text-foreground mb-2">Thank you for your order!</h1>
            <p className="text-sm text-foreground/50 mb-6">Order #{orderSuccess.order_number}</p>
            <div className="bg-card rounded-xl p-5 border border-border/40 text-left mb-8 space-y-2">
              <div className="flex justify-between text-xs text-foreground/50">
                <span>Shipping to:</span>
                <span className="font-semibold text-foreground">{name}</span>
              </div>
              <div className="flex justify-between text-xs text-foreground/50">
                <span>Payment method:</span>
                <span className="font-semibold text-foreground uppercase">
                  {orderSuccess.method === "razorpay" ? "Online Payment" : "Cash on Delivery"}
                </span>
              </div>
              <div className="flex justify-between text-xs text-foreground/50 border-t border-border/30 pt-2 mt-2">
                <span>Total amount:</span>
                <span className="font-bold text-foreground">₹{Number(orderSuccess.total ?? 0).toFixed(2)}</span>
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

  if (!authLoading && items.length === 0 && !orderSuccess) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black">
        <Navbar />
        <section className="flex-grow flex items-center justify-center p-6 py-32">
          <div className="bg-[#FEFDF9] rounded-3xl p-8 sm:p-12 border border-black/5 shadow-xl max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-full bg-black/5 text-amber-600 flex items-center justify-center mx-auto mb-6">
              <Sparkles className="w-8 h-8" />
            </div>
            <h2 className="font-dm font-normal text-3xl text-black tracking-[-0.04em] mb-2">Your Cart is Empty</h2>
            <p className="font-inter text-sm text-black/60 mb-8">Add items to your cart before proceeding to checkout.</p>
            <Button className="w-full bg-black text-white py-4 rounded-xl font-inter font-medium" onClick={() => setLocation("/products")}>
              Explore Products
            </Button>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
      <Navbar />

      {/* ── Hero / Header ── */}
      <section className="relative pt-36 pb-16 lg:pt-44 lg:pb-20 overflow-hidden bg-[#0E0E0E] text-white">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="mb-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 font-dm font-medium text-xs sm:text-sm text-white/80 tracking-[0.05em] uppercase">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span>Secure Checkout</span>
              </div>
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[44px] leading-[46px] sm:text-[68px] sm:leading-[64px] text-white">
                Finalize Your Order.
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="font-inter font-normal text-base text-white/55 max-w-[340px]"
            >
              All orders ship free. 100% money-back quality guarantee on every purchase.
            </motion.p>
          </div>
        </div>
      </section>

      <section className="py-16 bg-background flex-grow">
        <div className="container mx-auto px-6 max-w-5xl">
          <div className="flex flex-col lg:flex-row gap-10 items-start">
            {/* Checkout Form */}
            <form onSubmit={handlePlaceOrder} className="flex-1 space-y-6 w-full">
              <div className="bg-card rounded-2xl p-6 border border-border/50 space-y-4">
                <h3 className="text-sm font-semibold text-foreground border-b border-border/30 pb-3">
                  Delivery Details
                </h3>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground/60 mb-1.5">Full Name</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. Priya Sharma"
                      className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground/60 mb-1.5">Email Address</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="e.g. priya@gmail.com"
                      className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground/60 mb-1.5">Phone Number</label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="e.g. 9876543210"
                      className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground/60 mb-1.5">Town / City</label>
                    <input
                      type="text"
                      required
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      placeholder="e.g. Mumbai"
                      className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground/60 mb-1.5">Address</label>
                    <input
                      type="text"
                      required
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      placeholder="Street address, Apartment, Suite"
                      className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground/60 mb-1.5">State</label>
                    <input
                      type="text"
                      required
                      value={state}
                      onChange={e => setState(e.target.value)}
                      placeholder="e.g. Maharashtra"
                      className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground/60 mb-1.5">Postal Code</label>
                    <input
                      type="text"
                      required
                      value={postalCode}
                      onChange={e => setPostalCode(e.target.value)}
                      placeholder="400001"
                      className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground/60 mb-1.5">Country</label>
                    <input
                      type="text"
                      required
                      value={country}
                      onChange={e => setCountry(e.target.value)}
                      placeholder="e.g. India"
                      className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                </div>
              </div>

              {/* Payment Method */}
              <div className="bg-card rounded-2xl p-6 border border-border/50 space-y-4">
                <h3 className="text-sm font-semibold text-foreground border-b border-border/30 pb-3">
                  Payment Method
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Cash on Delivery */}
                  <div
                    onClick={() => setPaymentMethod("cod")}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col gap-2 ${
                      paymentMethod === "cod"
                        ? "border-primary bg-primary/5"
                        : "border-border/60 bg-muted/20 hover:border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <Wallet className="w-5 h-5 text-primary" />
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${paymentMethod === "cod" ? "border-primary bg-primary" : "border-border"}`}>
                        {paymentMethod === "cod" && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Cash on Delivery</p>
                      <p className="text-[10px] text-foreground/45 mt-0.5">Pay when delivered</p>
                    </div>
                  </div>

                  {/* Pay Online via Razorpay */}
                  <div
                    onClick={() => setPaymentMethod("razorpay")}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col gap-2 ${
                      paymentMethod === "razorpay"
                        ? "border-primary bg-primary/5"
                        : "border-border/60 bg-muted/20 hover:border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <CreditCard className="w-5 h-5 text-primary" />
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${paymentMethod === "razorpay" ? "border-primary bg-primary" : "border-border"}`}>
                        {paymentMethod === "razorpay" && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Pay Online</p>
                      <p className="text-[10px] text-foreground/45 mt-0.5">Card, UPI, Netbanking via Razorpay</p>
                    </div>
                  </div>
                </div>

                {paymentMethod === "razorpay" && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 text-[10px] text-foreground/50 bg-muted/30 px-3 py-2 rounded-lg border border-border/30"
                  >
                    <Shield className="w-3.5 h-3.5 text-green-700 shrink-0" />
                    <span>Your payment is secured by Razorpay. We never store your card details.</span>
                  </motion.div>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-foreground/40 px-2 justify-center">
                <Shield className="w-4 h-4 text-green-700" />
                <span>Secure Checkout powered by Earthora Farms</span>
              </div>
            </form>

            {/* Order Review panel */}
            <div className="w-full lg:w-80 space-y-6">
              <div className="bg-card rounded-2xl p-6 border border-border/50">
                <h3 className="text-sm font-semibold text-foreground mb-4 pb-2 border-b border-border/30">Order Review</h3>
                <div className="max-h-48 overflow-y-auto divide-y divide-border/20 mb-4 pr-1">
                  {items.map(item => (
                    <div key={item.id} className="py-3 flex items-center justify-between text-xs gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-foreground shrink-0">{item.quantity}x</span>
                        <span className="text-foreground/75 truncate">{item.name}</span>
                      </div>
                      <span className="font-semibold text-foreground shrink-0">₹{(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {/* Apply Coupon input */}
                <div className="pt-2 mb-4 border-t border-border/20">
                  <label className="block text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-1.5">Promo / Coupon Code</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponCode}
                      onChange={e => setCouponCode(e.target.value)}
                      placeholder="WELCOME10"
                      className="flex-1 px-3 py-2 text-xs bg-background border border-border/60 rounded-lg uppercase placeholder:normal-case focus:outline-none"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 text-xs border-primary/30 text-primary px-3 hover:bg-primary/5"
                      onClick={handleApplyCoupon}
                      disabled={couponLoading}
                    >
                      Apply
                    </Button>
                  </div>
                  {couponError && <p className="text-[10px] text-red-500 mt-1">{couponError}</p>}
                  {appliedCoupon && (
                    <p className="text-[10px] text-green-700 font-semibold mt-1 flex items-center gap-1">
                      <Ticket className="w-3 h-3" /> Coupon "{appliedCoupon.code}" applied!
                    </p>
                  )}
                </div>

                <div className="space-y-2 text-xs mb-4 border-t border-border/20 pt-4">
                  <div className="flex justify-between text-foreground/60">
                    <span>Subtotal</span>
                    <span>₹{subtotal.toFixed(2)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-green-700 font-semibold">
                      <span>Discount</span>
                      <span>- ₹{discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-foreground/60">
                    <span>Shipping</span>
                    <span className="text-green-700">FREE</span>
                  </div>
                </div>

                <div className="border-t border-border/40 pt-4 mb-6">
                  <div className="flex justify-between text-sm font-bold text-foreground">
                    <span>Total Amount</span>
                    <span>₹{totalAmount.toFixed(2)}</span>
                  </div>
                </div>

                <Button
                  className="w-full h-12 text-sm shadow-md"
                  onClick={handlePlaceOrder}
                  disabled={isSubmitting || items.length === 0}
                >
                  {isSubmitting
                    ? "Processing..."
                    : paymentMethod === "razorpay"
                    ? `Pay ₹${totalAmount.toFixed(2)} Online`
                    : `Place Order (COD)`}
                </Button>

                <div className="mt-4 flex items-center justify-center gap-1 text-[11px] text-foreground/40 hover:text-foreground/70 transition-colors cursor-pointer" onClick={() => setLocation("/cart")}>
                  <ArrowLeft className="w-3 h-3" />
                  Back to Cart
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
