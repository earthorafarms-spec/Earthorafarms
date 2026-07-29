import { motion } from "framer-motion";
import { Link } from "wouter";
import {
  RotateCcw,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  PackageX,
  CreditCard,
  Sparkles,
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

const returnSteps = [
  {
    num: "01",
    title: "Initiate Request",
    desc: "Contact us at contactus@earthorafarms.com or call our support line within 7 days of receiving your order.",
  },
  {
    num: "02",
    title: "Verification & Pickup",
    desc: "Our team will verify your batch details and arrange a reverse courier pickup from your delivery address.",
  },
  {
    num: "03",
    title: "Quality Audit",
    desc: "Once received at our facility, returned unopened products undergo a brief quality & seal verification.",
  },
  {
    num: "04",
    title: "Instant Refund",
    desc: "Approved refunds are credited back to your original payment method (or bank account for COD) within 3-5 days.",
  },
];

export default function ReturnsRefunds() {
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
            <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
            <span>Guaranteed Satisfaction</span>
          </motion.div>

          <div className="grid lg:grid-cols-12 gap-8 items-end">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="lg:col-span-8"
            >
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[42px] leading-[44px] sm:text-[66px] sm:leading-[62px] lg:text-[84px] lg:leading-[78px] text-white">
                100% Quality guarantee <br />
                <span className="text-white/35">& hassle-free returns.</span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="lg:col-span-4 font-inter font-normal text-base sm:text-lg text-white/55 leading-relaxed tracking-[-0.02em]"
            >
              We take pride in delivering raw, unadulterated botanical supplements. If your order doesn't meet our strict standards, we make it right.
            </motion.p>
          </div>
        </div>
      </section>

      {/* ── 4-Step Return Process ── */}
      <section className="py-20 lg:py-28">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="mb-14 pb-6 border-b border-black/10 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="font-inter text-xs uppercase tracking-wider text-black/40 font-medium block mb-2">
                Simple & Transparent
              </span>
              <h2 className="font-dm font-normal text-3xl sm:text-5xl text-black tracking-[-0.04em]">
                How Returns Work
              </h2>
            </div>
            <p className="font-inter text-sm text-black/60 max-w-sm">
              Our 4-step process ensures quick resolution and seamless refund processing.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {returnSteps.map((step, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 25 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: idx * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="bg-[#FEFDF9] p-8 rounded-3xl border border-black/5 flex flex-col justify-between shadow-xs hover:shadow-md transition-shadow"
              >
                <div>
                  <span className="font-dm text-3xl font-light text-emerald-800/40 block mb-4">
                    {step.num}
                  </span>
                  <h3 className="font-dm text-xl text-black tracking-[-0.02em] mb-3">
                    {step.title}
                  </h3>
                  <p className="font-inter text-sm text-black/60 leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Policy Conditions & Details ── */}
      <section className="py-16 bg-[#FEFDF9] border-y border-black/5">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-start">
            
            {/* Eligible Items Column */}
            <div className="lg:col-span-6 space-y-6">
              <span className="font-inter text-xs uppercase tracking-wider text-black/40 font-medium block">
                Eligibility Guidelines
              </span>
              <h2 className="font-dm font-normal text-3xl sm:text-4xl text-black tracking-[-0.04em]">
                Return Conditions
              </h2>
              
              <div className="space-y-4 pt-2">
                <div className="p-5 rounded-2xl bg-[#FAF9F5] border border-black/5 flex items-start gap-4">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-dm text-base text-black font-medium mb-1">Damaged or Defective Items</h4>
                    <p className="font-inter text-sm text-black/60 leading-relaxed">
                      If your package arrives damaged or seals are broken during transit, notify us within 48 hours for an immediate free replacement.
                    </p>
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-[#FAF9F5] border border-black/5 flex items-start gap-4">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-dm text-base text-black font-medium mb-1">Unopened Products</h4>
                    <p className="font-inter text-sm text-black/60 leading-relaxed">
                      Products returned in original, unopened condition with tamper seals intact within 7 days of delivery are eligible for 100% full refund.
                    </p>
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-[#FAF9F5] border border-black/5 flex items-start gap-4">
                  <PackageX className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-dm text-base text-black font-medium mb-1">Opened Product Guarantee</h4>
                    <p className="font-inter text-sm text-black/60 leading-relaxed">
                      Because our products are consumable wellness supplements, opened pouches or tablet jars cannot be restocked due to health safety codes. However, if you are unsatisfied with product quality, contact support for store credit options.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Refund Processing Column */}
            <div className="lg:col-span-6 space-y-8">
              <div>
                <h3 className="font-dm text-2xl text-black tracking-[-0.03em] mb-3 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-emerald-800" /> Refund Timelines
                </h3>
                <p className="font-inter text-sm text-black/65 leading-relaxed">
                  Once your returned item reaches our farm warehouse and passes inspection, refunds are processed within 24 hours:
                </p>
                <ul className="mt-3 space-y-2 font-inter text-sm text-black/70 list-disc list-inside">
                  <li><strong>Prepaid Orders (Cards, UPI, NetBanking):</strong> Refunded to original payment method in 3–5 business days.</li>
                  <li><strong>Cash on Delivery (COD):</strong> Bank transfer / UPI transfer initiated within 2 business days after collecting your bank details.</li>
                </ul>
              </div>

              <div>
                <h3 className="font-dm text-2xl text-black tracking-[-0.03em] mb-3 flex items-center gap-2">
                  <RotateCcw className="w-5 h-5 text-emerald-800" /> Cancellation Policy
                </h3>
                <p className="font-inter text-sm text-black/65 leading-relaxed">
                  You can cancel any order prior to dispatch (before 2:00 PM IST on dispatch day) directly via your account dashboard or by speaking to our Voice Ordering Assistant. Cancelled prepaid orders receive a 100% instant refund.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── Need Support CTA ── */}
      <section className="py-20 text-center">
        <div className="container mx-auto px-6 max-w-2xl">
          <ShieldCheck className="w-10 h-10 text-black/30 mx-auto mb-4" />
          <h2 className="font-dm text-3xl sm:text-4xl text-black tracking-[-0.04em] mb-3">
            Need help with a return or refund?
          </h2>
          <p className="font-inter text-sm text-black/60 leading-relaxed mb-8">
            Send us your order ID and photos of any damaged packaging — our team will resolve it swiftly.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/contact" className="px-6 py-3 rounded-xl bg-black text-white font-inter text-sm font-medium hover:bg-black/85 transition-colors">
              Submit Return Request
            </Link>
            <Link href="/faq" className="px-6 py-3 rounded-xl border border-black/15 font-inter text-sm font-medium text-black hover:bg-black/5 transition-colors">
              Read FAQs
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
