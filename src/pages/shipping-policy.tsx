import { motion } from "framer-motion";
import { Link } from "wouter";
import {
  Truck,
  Clock,
  ShieldCheck,
  Globe,
  Package,
  MapPin,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

const shippingHighlights = [
  {
    icon: Truck,
    title: "Complimentary Shipping",
    desc: "Free standard shipping on all prepaid orders across India with no minimum cart value required.",
    accent: "bg-[#ECEDEC]",
  },
  {
    icon: Clock,
    title: "Express 24-Hour Dispatch",
    desc: "Orders placed before 2:00 PM IST are processed, quality-checked, and dispatched on the same business day.",
    accent: "bg-[#FEFDF9]",
  },
  {
    icon: ShieldCheck,
    title: "Tamper-Evident Packaging",
    desc: "Shade-dried moringa packed in eco-friendly, UV-protective resealable pouches and reinforced recyclable cartons.",
    accent: "bg-[#ECEDEC]",
  },
  {
    icon: Globe,
    title: "International Express",
    desc: "Worldwide delivery via DHL Express / FedEx to over 30 countries with full real-time tracking.",
    accent: "bg-[#FEFDF9]",
  },
];

const deliveryTimelines = [
  { region: "Metro Cities (Mumbai, Delhi, Bengaluru, etc.)", time: "2 – 3 Business Days" },
  { region: "Tier-2 & Tier-3 Cities across India", time: "3 – 5 Business Days" },
  { region: "Special Territories (North-East, J&K, Islands)", time: "5 – 7 Business Days" },
  { region: "International Deliveries (US, UK, UAE, EU)", time: "5 – 9 Business Days" },
];

export default function ShippingPolicy() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
      <Navbar />

      {/* ── Page Hero Header ── */}
      <section className="relative pt-36 pb-20 lg:pt-44 lg:pb-28 bg-[#0E0E0E] text-white overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06)_0,transparent_70%)] pointer-events-none" />
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 font-dm font-medium text-xs sm:text-sm text-white/80 tracking-[0.05em] uppercase backdrop-blur-md"
          >
            <Truck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Farm to Doorstep Logistics</span>
          </motion.div>

          <div className="grid lg:grid-cols-12 gap-8 items-end">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="lg:col-span-8"
            >
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[42px] leading-[44px] sm:text-[66px] sm:leading-[62px] lg:text-[84px] lg:leading-[78px] text-white">
                Freshness delivered <br />
                <span className="text-white/35">without delay.</span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="lg:col-span-4 font-inter font-normal text-base sm:text-lg text-white/55 leading-relaxed tracking-[-0.02em]"
            >
              Our transparent shipping policies ensure your organic moringa powder and tablets reach you at peak botanical potency.
            </motion.p>
          </div>
        </div>
      </section>

      {/* ── Key Highlights Grid ── */}
      <section className="py-20 lg:py-28">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="mb-14 pb-6 border-b border-black/10 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="font-inter text-xs uppercase tracking-wider text-black/40 font-medium block mb-2">
                Logistics Promise
              </span>
              <h2 className="font-dm font-normal text-3xl sm:text-5xl text-black tracking-[-0.04em]">
                Shipping Standards
              </h2>
            </div>
            <p className="font-inter text-sm text-black/60 max-w-sm">
              Carefully packed directly at our Aptos farm facilities with full temperature & UV protections.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {shippingHighlights.map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 25 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: idx * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="bg-[#FEFDF9] p-8 rounded-3xl border border-black/5 flex flex-col justify-between shadow-xs hover:shadow-md transition-shadow"
              >
                <div>
                  <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center mb-6">
                    <item.icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-dm text-xl text-black tracking-[-0.02em] mb-3">
                    {item.title}
                  </h3>
                  <p className="font-inter text-sm text-black/60 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Detailed Timelines & Policies ── */}
      <section className="py-16 bg-[#FEFDF9] border-y border-black/5">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-start">
            
            {/* Delivery Timelines Column */}
            <div className="lg:col-span-6 space-y-6">
              <span className="font-inter text-xs uppercase tracking-wider text-black/40 font-medium block">
                Estimated Transit Times
              </span>
              <h2 className="font-dm font-normal text-3xl sm:text-4xl text-black tracking-[-0.04em]">
                Domestic & Global Schedule
              </h2>
              <p className="font-inter text-sm text-black/60 leading-relaxed mb-6">
                All shipments include automated SMS and WhatsApp tracking links dispatched immediately upon courier handoff.
              </p>

              <div className="space-y-4">
                {deliveryTimelines.map((row, i) => (
                  <div key={i} className="p-5 rounded-2xl bg-[#FAF9F5] border border-black/5 flex items-center justify-between gap-4">
                    <span className="font-inter text-sm font-medium text-black/80">{row.region}</span>
                    <span className="font-dm text-sm font-semibold text-emerald-800 shrink-0 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200/60">
                      {row.time}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed Shipping Guidelines Column */}
            <div className="lg:col-span-6 space-y-8">
              <div>
                <h3 className="font-dm text-2xl text-black tracking-[-0.03em] mb-3 flex items-center gap-2">
                  <Package className="w-5 h-5 text-emerald-800" /> Order Tracking & Dispatch
                </h3>
                <p className="font-inter text-sm text-black/65 leading-relaxed">
                  Once your order is confirmed, our farm team packs your moringa in UV-proof pouches. You will receive an email and SMS with your courier tracking number (BlueDart, Delhivery, or FedEx) within 24 hours of dispatch.
                </p>
              </div>

              <div>
                <h3 className="font-dm text-2xl text-black tracking-[-0.03em] mb-3 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-emerald-800" /> Address Adjustments
                </h3>
                <p className="font-inter text-sm text-black/65 leading-relaxed">
                  Need to update your delivery address? If your order has not yet left our facility, contact our support team at <a href="mailto:contactus@earthorafarms.com" className="text-emerald-800 font-medium underline">contactus@earthorafarms.com</a> before 2:00 PM IST.
                </p>
              </div>

              <div>
                <h3 className="font-dm text-2xl text-black tracking-[-0.03em] mb-3 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-emerald-800" /> Customs & Duties
                </h3>
                <p className="font-inter text-sm text-black/65 leading-relaxed">
                  For international orders outside India, local customs duties or import taxes may apply depending on your destination country's regulations. These fees are the responsibility of the recipient.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── Help Banner CTA ── */}
      <section className="py-20 text-center">
        <div className="container mx-auto px-6 max-w-2xl">
          <HelpCircle className="w-10 h-10 text-black/30 mx-auto mb-4" />
          <h2 className="font-dm text-3xl sm:text-4xl text-black tracking-[-0.04em] mb-3">
            Have questions about your order?
          </h2>
          <p className="font-inter text-sm text-black/60 leading-relaxed mb-8">
            Our farm customer care team is available Monday through Friday to assist with tracking or logistics inquiries.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/contact" className="px-6 py-3 rounded-xl bg-black text-white font-inter text-sm font-medium hover:bg-black/85 transition-colors">
              Contact Support
            </Link>
            <Link href="/our-product" className="px-6 py-3 rounded-xl border border-black/15 font-inter text-sm font-medium text-black hover:bg-black/5 transition-colors">
              Browse Products
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
