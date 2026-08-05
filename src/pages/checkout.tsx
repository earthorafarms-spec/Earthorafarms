import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, CreditCard, Shield, Sparkles, CheckCircle2, Ticket, Wallet, Loader2, Check, X, XCircle, ChevronDown, Globe, Search } from "lucide-react";
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

const COUNTRIES = [
  {
    name: "India",
    code: "IN",
    flag: "🇮🇳",
    phoneRegex: /^[6-9]\d{9}$/,
    phoneHint: "10 digits starting with 6–9",
    postalRegex: /^\d{6}$/,
    postalHint: "6-digit PIN code",
  },
  {
    name: "United States",
    code: "US",
    flag: "🇺🇸",
    phoneRegex: /^[2-9]\d{9}$/,
    phoneHint: "10-digit US number",
    postalRegex: /^\d{5}(-\d{4})?$/,
    postalHint: "5-digit ZIP (or ZIP+4)",
  },
  {
    name: "United Kingdom",
    code: "GB",
    flag: "🇬🇧",
    phoneRegex: /^(\+44|0)7\d{9}$/,
    phoneHint: "UK mobile starting with 07 or +447",
    postalRegex: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
    postalHint: "UK postcode e.g. SW1A 1AA",
  },
  {
    name: "Canada",
    code: "CA",
    flag: "🇨🇦",
    phoneRegex: /^[2-9]\d{9}$/,
    phoneHint: "10-digit Canadian number",
    postalRegex: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i,
    postalHint: "Postal code e.g. K1A 0B1",
  },
  {
    name: "Australia",
    code: "AU",
    flag: "🇦🇺",
    phoneRegex: /^(04\d{8}|(\+61)?4\d{8})$/,
    phoneHint: "Australian mobile e.g. 0412345678",
    postalRegex: /^\d{4}$/,
    postalHint: "4-digit postcode",
  },
  {
    name: "Germany",
    code: "DE",
    flag: "🇩🇪",
    phoneRegex: /^(\+49|0)\d{10,11}$/,
    phoneHint: "German number e.g. +491234567890",
    postalRegex: /^\d{5}$/,
    postalHint: "5-digit PLZ",
  },
  {
    name: "France",
    code: "FR",
    flag: "🇫🇷",
    phoneRegex: /^(\+33|0)[67]\d{8}$/,
    phoneHint: "French mobile e.g. +33612345678",
    postalRegex: /^\d{5}$/,
    postalHint: "5-digit code postal",
  },
  {
    name: "UAE",
    code: "AE",
    flag: "🇦🇪",
    phoneRegex: /^(\+971|0)?5\d{8}$/,
    phoneHint: "UAE mobile e.g. +971501234567",
    postalRegex: /^\d{5,6}$/,
    postalHint: "5–6 digit postal code",
  },
  {
    name: "Singapore",
    code: "SG",
    flag: "🇸🇬",
    phoneRegex: /^[89]\d{7}$/,
    phoneHint: "8-digit SG number starting with 8 or 9",
    postalRegex: /^\d{6}$/,
    postalHint: "6-digit postal code",
  },
  {
    name: "Other",
    code: "XX",
    flag: "🌐",
    phoneRegex: /.+/,
    phoneHint: "",
    postalRegex: /.+/,
    postalHint: "",
  },
] as const;

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
  const [country, setCountry] = useState("India");
  const [gst, setGst] = useState("");
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);

  const selectedCountry = useMemo(() => {
    return COUNTRIES.find((c) => c.name === country) || COUNTRIES[0];
  }, [country]);

  // Coupon
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<any | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState("");

  const paymentMethod = "razorpay";
  const [allowMarketing, setAllowMarketing] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<any | null>(null);

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const shippingAmount = 0; // free shipping

  // Calculate discount if coupon is applied
  const discountAmount = useMemo(() => {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.type === "percentage") {
      return (subtotal * appliedCoupon.value) / 100;
    } else {
      return Math.min(subtotal, appliedCoupon.value);
    }
  }, [appliedCoupon, subtotal]);

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
          setCountry((data.user_country as string) || "India");
          setGst((data.user_gst as string) || "");
        } else {
          setEmail(emailAddr || "");
          setName(user?.user_metadata?.name || user?.user_metadata?.full_name || "");
          setPhone(user?.phone || "");
          setCountry("India");
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
        user_name: name,
        user_phone: phone,
        user_address: address,
        user_city: city,
        user_state: state,
        user_zip: postalCode,
        user_country: country,
        user_gst: gst,
      })
      .eq("user_email", user?.email);

    // 2. Insert order rows
    const orderRows = items.map((item) => ({
      order_user_id: user?.email || "",
      order_product_id: item.id,
      order_product_quantity: String(item.quantity),
      order_product_price: String(item.price),
    }));

    const { data: insertedOrders, error: orderInsertErr } = await (supabase.from("Orders") as any)
      .insert(orderRows)
      .select();

    if (orderInsertErr) throw orderInsertErr;

    const orderReferenceId = String(insertedOrders?.[0]?.id || Date.now());

    // 3. Insert payment record
    await (supabase.from("Payments") as any).insert({
      payment_order_id: orderReferenceId,
      payment_amount: String(totalAmount),
      payment_status: status,
      payment_method: "RAZORPAY",
      payment_transaction_id: txnId,
    });

    // 4. Insert order history
    await (supabase.from("Order_history") as any).insert({
      order_id: orderReferenceId,
      order_status: status === "completed" ? "pending" : "cancelled",
    });

    return orderReferenceId;
  };


  // ── Razorpay flow ─────────────────────────────────────────────────────────────
  const handleRazorpayOrder = async () => {
    const amountPaise = Math.round(totalAmount * 100);
    if (amountPaise < 100) {
      toast({ title: "Order too small", description: "Minimum order amount is ₹1.", variant: "destructive" });
      return;
    }

    // Step 1: Create Razorpay order via serverless function
    let order_id = "";
    let key_id = RAZORPAY_KEY_ID;
    try {
      const createRes = await fetch("/.netlify/functions/create-razorpay-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          receipt: `rcpt_${Date.now()}`,
        }),
      });

      if (createRes.ok) {
        const orderData = await createRes.json();
        order_id = orderData.order_id || orderData.id;
        key_id = orderData.key_id || key_id;
      } else {
        const errJson = await createRes.json().catch(() => ({}));
        throw new Error(errJson.error || "Could not create payment order.");
      }
    } catch (err: any) {
      if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
        order_id = `order_demo_${Date.now()}`;
      } else {
        throw err;
      }
    }

    // Step 2: Open Razorpay modal
    return new Promise<void>((resolve, reject) => {
      openRazorpayModal({
        orderId: order_id,
        amount: amountPaise,
        currency: "INR",
        keyId: key_id,
        prefill: { name, email, contact: phone },
        onDismiss: () => {
          reject(new Error("Payment cancelled by user."));
        },
        onFailure: (reason) => {
          reject(new Error(reason || "Payment failed."));
        },
        onSuccess: async (response: RazorpaySuccessResponse) => {
          try {
            // Step 3: Verify signature server-side
            const verifyRes = await fetch("/.netlify/functions/verify-razorpay-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
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

            // Trigger invoice email sending asynchronously
            try {
              supabase.functions.invoke("send-invoice", {
                body: { orderId: orderReferenceId },
              });
            } catch (emailErr) {
              console.error("Error triggering invoice email:", emailErr);
            }

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

  const handlePhoneBlur = () => {
    if (!phone) return;
    if (selectedCountry && selectedCountry.code !== "XX") {
      const strippedPhone = phone.replace(/[\s-]/g, "");
      if (!selectedCountry.phoneRegex.test(strippedPhone)) {
        toast({
          title: "Invalid phone number",
          description: `Phone number doesn't match ${selectedCountry.name} format. Expected: ${selectedCountry.phoneHint}`,
          variant: "destructive",
        });
      }
    }
  };

  const handlePostalBlur = () => {
    if (!postalCode) return;
    if (selectedCountry && selectedCountry.code !== "XX") {
      if (!selectedCountry.postalRegex.test(postalCode.trim())) {
        toast({
          title: "Invalid postal code",
          description: `Postal code doesn't match ${selectedCountry.name} format. Expected: ${selectedCountry.postalHint}`,
          variant: "destructive",
        });
      }
    }
  };

  const handleCountryChange = (newCountry: string) => {
    setCountry(newCountry);
    setPhone("");
    setPostalCode("");
    toast({
      title: "Country changed",
      description: "Please re-enter your phone number and postal code for the new country.",
    });
  };

  // ── Main submit handler ───────────────────────────────────────────────────────
  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) return;

    // Re-validate phone
    if (selectedCountry && selectedCountry.code !== "XX") {
      const cleanPhone = phone.replace(/[\s-]/g, "");
      if (!selectedCountry.phoneRegex.test(cleanPhone)) {
        toast({
          title: "Invalid phone number",
          description: `Expected format for ${selectedCountry.name}: ${selectedCountry.phoneHint}`,
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Re-validate postal code
      if (!selectedCountry.postalRegex.test(postalCode.trim())) {
        toast({
          title: "Invalid postal code",
          description: `Expected format for ${selectedCountry.name}: ${selectedCountry.postalHint}`,
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }
    }

    if (!name || !email || !phone || !address || !city || !state || !postalCode || !country) {
      toast({ title: "Missing fields", description: "Please fill in all shipping details.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      await handleRazorpayOrder();
    } catch (err: any) {
      const msg = err?.message || "An unexpected error occurred.";
      if (!msg.includes("cancelled")) {
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
                <span className="font-semibold text-foreground">
                  Online Payment
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
            <Button className="w-full bg-black text-white py-4 rounded-xl font-inter font-medium" onClick={() => setLocation("/our-product")}>
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
                      onBlur={handlePhoneBlur}
                      placeholder="e.g. 9876543210"
                      className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                    {selectedCountry && selectedCountry.phoneHint && (
                      <p className="text-[10px] text-foreground/45 mt-1">{selectedCountry.phoneHint}</p>
                    )}
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
                      onBlur={handlePostalBlur}
                      placeholder="400001"
                      className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                    {selectedCountry && selectedCountry.postalHint && (
                      <p className="text-[10px] text-foreground/45 mt-1">{selectedCountry.postalHint}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground/60 mb-1.5">Country</label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setCountryDropdownOpen(!countryDropdownOpen)}
                        className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground flex items-center justify-between text-left transition-all"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <span className="text-base leading-none">{selectedCountry.flag}</span>
                          <span>{selectedCountry.name}</span>
                        </span>
                        <ChevronDown className={`w-4 h-4 text-foreground/50 transition-transform duration-200 ${countryDropdownOpen ? "rotate-180" : ""}`} />
                      </button>

                      {countryDropdownOpen && (
                        <>
                          {/* Backdrop click to close */}
                          <div
                            className="fixed inset-0 z-20"
                            onClick={() => setCountryDropdownOpen(false)}
                          />

                          {/* Custom Dropdown Menu */}
                          <div className="absolute left-0 right-0 top-full mt-1.5 bg-background border border-border/80 rounded-xl shadow-xl z-30 py-1.5 max-h-60 overflow-y-auto divide-y divide-border/20 backdrop-blur-md">
                            {COUNTRIES.map((c) => {
                              const isSelected = c.name === country;
                              return (
                                <button
                                  key={c.code}
                                  type="button"
                                  onClick={() => {
                                    handleCountryChange(c.name);
                                    setCountryDropdownOpen(false);
                                  }}
                                  className={`w-full px-3.5 py-2 text-xs flex items-center justify-between text-left transition-colors ${
                                    isSelected
                                      ? "bg-primary/10 text-primary font-semibold"
                                      : "text-foreground/80 hover:bg-muted/60"
                                  }`}
                                >
                                  <span className="flex items-center gap-2">
                                    <span className="text-sm">{c.flag}</span>
                                    <span>{c.name}</span>
                                  </span>
                                  {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* GST Number */}
                <div className="pt-2 border-t border-border/30">
                  <label className="block text-xs font-medium text-foreground/60 mb-1.5">GSTIN / Tax Number (Optional)</label>
                  <input
                    type="text"
                    value={gst}
                    onChange={e => setGst(e.target.value)}
                    placeholder="22AAAAA0000A1Z5"
                    className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 uppercase"
                  />
                </div>

                {/* Marketing Consent Checkbox */}
                <div className="pt-4 border-t border-border/30">
                  <label className="flex items-start gap-3 cursor-pointer group select-none">
                    <input
                      type="checkbox"
                      checked={allowMarketing}
                      onChange={(e) => setAllowMarketing(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-border/70 text-primary focus:ring-primary/30 accent-emerald-700 cursor-pointer"
                    />
                    <span className="text-xs text-foreground/75 leading-relaxed font-inter">
                      Keep me updated via WhatsApp & SMS with exclusive farm offers, new harvest announcements, and wellness recipes.
                    </span>
                  </label>
                </div>
              </div>

              {/* Payment Method */}
              <div className="bg-card rounded-2xl p-6 border border-border/50 space-y-4">
                <h3 className="text-sm font-semibold text-foreground border-b border-border/30 pb-3">
                  Payment Method
                </h3>
                <div className="flex items-center gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
                  <CreditCard className="w-5 h-5 text-primary shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-foreground">Pay Online via Razorpay</p>
                    <p className="text-[10px] text-foreground/50 mt-0.5">Card, UPI, Netbanking and Wallet accepted</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-foreground/50 bg-muted/30 px-3 py-2 rounded-lg border border-border/30">
                  <Shield className="w-3.5 h-3.5 text-green-700 shrink-0" />
                  <span>Your payment is secured by Razorpay. We never store your card details.</span>
                </div>
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
