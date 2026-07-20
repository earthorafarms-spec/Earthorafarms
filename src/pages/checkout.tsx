import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, CreditCard, Shield, Truck, Sparkles, CheckCircle2, Ticket, Wallet, Leaf, Eye, EyeOff, Mail, Lock, User } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/cart-context";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

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

  const [paymentMethod, setPaymentMethod] = useState<"cod" | "card" | "upi">("cod");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [upiId, setUpiId] = useState("");

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
    supabase
      .from("User_details")
      .select("*")
      .eq("user_email", user.email)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setEmail(data.user_email || user.email || "");
          setName(data.user_name || user.user_metadata?.name || "");
          setPhone(data.user_phone || "");
          setAddress(data.user_address || "");
          setCity(data.user_city || "");
          setState(data.user_state || "");
          setPostalCode(data.user_zip || "");
          setCountry(data.user_country || "");
        } else {
          setEmail(user.email || "");
          setName(user.user_metadata?.name || user.user_metadata?.full_name || "");
          setPhone(user.phone || "");
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

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) return;

    if (!name || !email || !phone || !address || !city || !state || !postalCode || !country) {
      toast({ title: "Missing fields", description: "Please fill in all shipping details.", variant: "destructive" });
      return;
    }

    if (paymentMethod !== "cod") {
      toast({ title: "Payment method unavailable", description: "Only Cash on Delivery is available right now. Online payments coming soon.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Update user shipping details in User_details
      const { error: userUpdateErr } = await supabase
        .from("User_details")
        .update({
          user_name: name,
          user_phone: phone,
          user_address: address,
          user_city: city,
          user_state: state,
          user_zip: postalCode,
          user_country: country,
        })
        .eq("user_email", user?.email);

      if (userUpdateErr) console.error("Error updating user details:", userUpdateErr);

      // 2. Insert items into Orders
      const orderRows = items.map((item) => ({
        order_user_id: user?.email || "",
        order_product_id: item.id,
        order_product_quantity: String(item.quantity),
        order_product_price: String(item.price),
      }));

      const { data: insertedOrders, error: orderInsertErr } = await supabase
        .from("Orders")
        .insert(orderRows)
        .select();

      if (orderInsertErr) throw orderInsertErr;

      const orderReferenceId = String(insertedOrders?.[0]?.id || Date.now());
      const transactionId = `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // 3. Insert into Payments
      const { error: paymentErr } = await supabase
        .from("Payments")
        .insert({
          payment_order_id: orderReferenceId,
          payment_amount: String(totalAmount),
          payment_status: "completed",
          payment_method: "UPI",
          payment_transaction_id: transactionId,
        });

      if (paymentErr) console.error("Error creating payment record:", paymentErr);

      // 4. Insert into Order_history
      const { error: historyErr } = await supabase
        .from("Order_history")
        .insert({
          order_id: orderReferenceId,
          order_status: "pending",
        });

      if (historyErr) console.error("Error creating order history:", historyErr);

      setOrderSuccess({ order_number: orderReferenceId, method: paymentMethod });
      clearCart();
      toast({ title: "Order placed successfully!", description: `Order ID: ${orderReferenceId}` });
    } catch (err: any) {
      toast({ title: "Order error", description: err.message || "An unexpected error occurred.", variant: "destructive" });
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
                <span className="font-semibold text-foreground uppercase">{orderSuccess.method}</span>
              </div>
              <div className="flex justify-between text-xs text-foreground/50 border-t border-border/30 pt-2 mt-2">
                <span>Total amount:</span>
                <span className="font-bold text-foreground">₹{totalAmount.toFixed(2)}</span>
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

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/20">
      <Navbar />

      <section className="relative pt-40 pb-12 overflow-hidden bg-primary">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05)_0,transparent_70%)]" />
        <div className="container mx-auto px-6 max-w-7xl relative z-10">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl font-serif text-primary-foreground leading-[1.1] tracking-tight">
              Checkout
            </h1>
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

              {/* Payment Details */}
              <div className="bg-card rounded-2xl p-6 border border-border/50 space-y-4">
                <h3 className="text-sm font-semibold text-foreground border-b border-border/30 pb-3">
                  Payment Method
                </h3>
                
                {/* COD - only active method until Razorpay is integrated */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Cash on Delivery - Active */}
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

                  {/* Card - Coming Soon */}
                  <div className="p-4 rounded-xl border-2 border-border/30 bg-muted/10 flex flex-col gap-2 opacity-60 cursor-not-allowed relative overflow-hidden">
                    <span className="absolute top-2 right-2 text-[8px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">Soon</span>
                    <div className="flex items-center justify-between">
                      <CreditCard className="w-5 h-5 text-foreground/30" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground/40">Pay with Card</p>
                      <p className="text-[10px] text-foreground/30 mt-0.5">Razorpay ΓÇö Coming soon</p>
                    </div>
                  </div>

                  {/* UPI - Coming Soon */}
                  <div className="p-4 rounded-xl border-2 border-border/30 bg-muted/10 flex flex-col gap-2 opacity-60 cursor-not-allowed relative overflow-hidden">
                    <span className="absolute top-2 right-2 text-[8px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">Soon</span>
                    <div className="flex items-center justify-between">
                      <Sparkles className="w-5 h-5 text-foreground/30" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground/40">UPI Transfer</p>
                      <p className="text-[10px] text-foreground/30 mt-0.5">GPay, PhonePe ΓÇö Coming soon</p>
                    </div>
                  </div>
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
                  {isSubmitting ? "Processing..." : `Pay ₹${totalAmount.toFixed(2)}`}
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
