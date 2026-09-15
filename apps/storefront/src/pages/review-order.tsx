import { useEffect, useState, ReactNode } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { CheckCircle, XCircle, Clock, ShoppingBag, Phone } from "lucide-react";

type PaymentState = "success" | "failed" | "pending" | "loading";

export default function ReviewOrder() {
  const [state, setState] = useState<PaymentState>("loading");
  const [linkId, setLinkId] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("razorpay_payment_link_status");
    const id = params.get("razorpay_payment_link_id") || "";

    setLinkId(id);

    if (status === "paid") {
      setState("success");
    } else if (status === "cancelled" || status === "expired") {
      setState("failed");
    } else {
      // No params or unknown status — default to pending review
      setState("pending");
    }
  }, []);

  const content: Record<
    PaymentState,
    {
      icon: ReactNode;
      iconBg: string;
      title: string;
      subtitle: string;
      body: string;
      showHome: boolean;
      showContact: boolean;
    }
  > = {
    loading: {
      icon: <Clock className="w-8 h-8 animate-spin" />,
      iconBg: "bg-white/10 text-white/60 border-white/15",
      title: "Checking your payment…",
      subtitle: "",
      body: "Please wait a moment while we verify your transaction details.",
      showHome: false,
      showContact: false,
    },
    success: {
      icon: <CheckCircle className="w-8 h-8" />,
      iconBg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      title: "Payment Successful!",
      subtitle: "Your order is being confirmed.",
      body: "Thank you for your purchase from Earthora Farms. Your order has been placed and will be confirmed shortly. You will receive an email & SMS update once it is dispatched.",
      showHome: true,
      showContact: true,
    },
    failed: {
      icon: <XCircle className="w-8 h-8" />,
      iconBg: "bg-rose-500/20 text-rose-400 border-rose-500/30",
      title: "Payment Not Completed",
      subtitle: "Your order was not placed.",
      body: "Your payment was cancelled or the link expired. No money has been deducted. Please call us or place your order again through the website.",
      showHome: true,
      showContact: true,
    },
    pending: {
      icon: <ShoppingBag className="w-8 h-8" />,
      iconBg: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      title: "Order Review",
      subtitle: "Complete your payment to confirm.",
      body: "If you received a payment link from Earthora Farms, please complete the payment to confirm your order. If you have already paid, your order is being processed.",
      showHome: true,
      showContact: true,
    },
  };

  const c = content[state];

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0E0E0E] text-white p-6 relative overflow-hidden selection:bg-white selection:text-black">
      {/* Background radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06)_0,transparent_75%)] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-md w-full bg-[#181818] border border-white/10 rounded-3xl p-8 sm:p-10 text-center shadow-2xl relative z-10"
      >
        <div
          className={`w-16 h-16 rounded-2xl border flex items-center justify-center mx-auto mb-6 ${c.iconBg}`}
        >
          {c.icon}
        </div>

        <h1 className="font-dm font-normal text-2xl text-white tracking-[-0.03em] mb-2">
          {c.title}
        </h1>

        {c.subtitle && (
          <p className="font-inter text-sm text-white/50 mb-4">{c.subtitle}</p>
        )}

        <p className="font-inter font-normal text-sm text-white/60 leading-relaxed mb-8">
          {c.body}
        </p>

        {/* Earthora branding */}
        <div className="flex items-center justify-center gap-2 mb-8 py-3 px-4 bg-white/5 rounded-xl border border-white/10">
          <div className="w-6 h-6 rounded-full bg-[#3D6B4F] flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">E</span>
          </div>
          <span className="font-dm text-sm text-white/70">Earthora Farms</span>
        </div>

        <div className="flex flex-col gap-3">
          {c.showHome && (
            <Link
              href="/"
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-white text-black font-inter font-medium text-sm rounded-xl hover:bg-white/90 transition-colors shadow-lg"
            >
              <ShoppingBag className="w-4 h-4" />
              Shop More Products
            </Link>
          )}
          {c.showContact && (
            <a
              href="tel:+919825346884"
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-white/10 border border-white/10 text-white/80 font-inter font-medium text-sm rounded-xl hover:bg-white/15 transition-colors"
            >
              <Phone className="w-4 h-4" />
              Call Us for Help
            </a>
          )}
        </div>
      </motion.div>
    </div>
  );
}
