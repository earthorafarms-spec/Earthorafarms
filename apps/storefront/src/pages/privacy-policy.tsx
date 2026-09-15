import { motion } from "framer-motion";
import { Link } from "wouter";
import { ShieldCheck, Lock, Eye, FileText, Bell, Server, UserCheck } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

export default function PrivacyPolicy() {
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
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Data Protection & Privacy</span>
          </motion.div>

          <div className="grid lg:grid-cols-12 gap-8 items-end">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="lg:col-span-8"
            >
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[42px] leading-[44px] sm:text-[66px] sm:leading-[62px] lg:text-[84px] lg:leading-[78px] text-white">
                Your privacy is our <br />
                <span className="text-white/35">sacred trust.</span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="lg:col-span-4 font-inter font-normal text-base sm:text-lg text-white/55 leading-relaxed tracking-[-0.02em]"
            >
              Learn how Earthora Farms collects, protects, and handles your personal information across our website and logistics.
            </motion.p>
          </div>
        </div>
      </section>

      {/* ── Privacy Policy Content ── */}
      <section className="py-20 lg:py-28">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1000px]">
          
          <div className="bg-[#FEFDF9] p-8 sm:p-12 rounded-3xl border border-black/5 space-y-12 shadow-xs">
            
            {/* Last Updated */}
            <div className="pb-6 border-b border-black/10 flex items-center justify-between text-xs text-black/50 font-inter">
              <span>Effective Date: July 29, 2026</span>
              <span>Version 1.2</span>
            </div>

            {/* Section 1 */}
            <div className="space-y-4">
              <h2 className="font-dm text-2xl sm:text-3xl text-black tracking-[-0.03em] flex items-center gap-3">
                <Eye className="w-6 h-6 text-emerald-800 shrink-0" /> 1. Information We Collect
              </h2>
              <p className="font-inter text-sm sm:text-base text-black/65 leading-relaxed">
                At Earthora Farms Pvt. Ltd., we respect your personal data. We collect information you provide directly to us when making purchases or subscribing to newsletters:
              </p>
              <ul className="list-disc list-inside font-inter text-sm text-black/70 space-y-2 pl-2">
                <li><strong>Contact Details:</strong> Full name, delivery address, phone number, email address, and 6-digit PIN code.</li>
                <li><strong>Transaction History:</strong> Order details, Razorpay payment link statuses, and delivery confirmations. We do NOT store credit card numbers directly.</li>
              </ul>
            </div>

            {/* Section 2 */}
            <div className="space-y-4 pt-4 border-t border-black/5">
              <h2 className="font-dm text-2xl sm:text-3xl text-black tracking-[-0.03em] flex items-center gap-3">
                <Server className="w-6 h-6 text-emerald-800 shrink-0" /> 2. How We Use Your Data
              </h2>
              <p className="font-inter text-sm sm:text-base text-black/65 leading-relaxed">
                Your data is strictly utilized to provide an exceptional organic shopping experience:
              </p>
              <ul className="list-disc list-inside font-inter text-sm text-black/70 space-y-2 pl-2">
                <li>Fulfilling and delivering your moringa powder and tablet orders via courier partners.</li>
                <li>Sending order confirmation SMS, WhatsApp payment links, and dispatch tracking alerts via Tata SmartFlow.</li>
                <li>Preventing fraudulent transactions and ensuring network security.</li>
              </ul>
            </div>

            {/* Section 3 */}
            <div className="space-y-4 pt-4 border-t border-black/5">
              <h2 className="font-dm text-2xl sm:text-3xl text-black tracking-[-0.03em] flex items-center gap-3">
                <Lock className="w-6 h-6 text-emerald-800 shrink-0" /> 3. Data Protection & Sharing
              </h2>
              <p className="font-inter text-sm sm:text-base text-black/65 leading-relaxed">
                We never sell, rent, or trade your personal data to third-party marketers. We only share relevant details with trusted service infrastructure partners:
              </p>
              <ul className="list-disc list-inside font-inter text-sm text-black/70 space-y-2 pl-2">
                <li><strong>Payment Gateways:</strong> Razorpay Software Private Limited for secure checkout processing.</li>
                <li><strong>Telephony & SMS:</strong> Tata Communications (SmartFlo/SmartFlow) for call routing and SMS/WhatsApp link dispatch.</li>
                <li><strong>Logistics Partners:</strong> BlueDart, Delhivery, and FedEx for order transit.</li>
              </ul>
            </div>

            {/* Section 4 */}
            <div className="space-y-4 pt-4 border-t border-black/5">
              <h2 className="font-dm text-2xl sm:text-3xl text-black tracking-[-0.03em] flex items-center gap-3">
                <UserCheck className="w-6 h-6 text-emerald-800 shrink-0" /> 4. Your Rights & Data Deletion
              </h2>
              <p className="font-inter text-sm sm:text-base text-black/65 leading-relaxed">
                You hold full control over your personal records. You may request to review, update, or permanently delete your account details and call history by contacting our Data Protection Officer at <a href="mailto:privacy@earthorafarms.com" className="text-emerald-800 font-medium underline">privacy@earthorafarms.com</a>.
              </p>
            </div>

          </div>

        </div>
      </section>

      <Footer />
    </div>
  );
}
