import { motion } from "framer-motion";
import { Link } from "wouter";
import { FileText, Scale, ShieldAlert, ShoppingBag, Award, HelpCircle } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

export default function TermsOfUse() {
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
            <Scale className="w-3.5 h-3.5 text-emerald-400" />
            <span>Legal Framework</span>
          </motion.div>

          <div className="grid lg:grid-cols-12 gap-8 items-end">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="lg:col-span-8"
            >
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[42px] leading-[44px] sm:text-[66px] sm:leading-[62px] lg:text-[84px] lg:leading-[78px] text-white">
                Terms of service <br />
                <span className="text-white/35">& store agreement.</span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="lg:col-span-4 font-inter font-normal text-base sm:text-lg text-white/55 leading-relaxed tracking-[-0.02em]"
            >
              Please read these terms governing your access to Earthora Farms website and mobile purchase interfaces.
            </motion.p>
          </div>
        </div>
      </section>

      {/* ── Terms Content ── */}
      <section className="py-20 lg:py-28">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1000px]">
          
          <div className="bg-[#FEFDF9] p-8 sm:p-12 rounded-3xl border border-black/5 space-y-12 shadow-xs">
            
            {/* Last Updated */}
            <div className="pb-6 border-b border-black/10 flex items-center justify-between text-xs text-black/50 font-inter">
              <span>Effective Date: July 29, 2026</span>
              <span>Earthora Farms Pvt. Ltd.</span>
            </div>

            {/* Section 1 */}
            <div className="space-y-4">
              <h2 className="font-dm text-2xl sm:text-3xl text-black tracking-[-0.03em] flex items-center gap-3">
                <FileText className="w-6 h-6 text-emerald-800 shrink-0" /> 1. Agreement to Terms
              </h2>
              <p className="font-inter text-sm sm:text-base text-black/65 leading-relaxed">
                By visiting earthorafarms.com or placing an order, you agree to be bound by these Terms of Use and all applicable laws of India.
              </p>
            </div>

            {/* Section 2 */}
            <div className="space-y-4 pt-4 border-t border-black/5">
              <h2 className="font-dm text-2xl sm:text-3xl text-black tracking-[-0.03em] flex items-center gap-3">
                <ShoppingBag className="w-6 h-6 text-emerald-800 shrink-0" /> 2. Product Availability & Pricing
              </h2>
              <p className="font-inter text-sm sm:text-base text-black/65 leading-relaxed">
                We make every effort to display accurate product descriptions, stock levels, and prices. Prices are listed in Indian Rupees (INR) inclusive of applicable taxes. Earthora Farms reserves the right to adjust prices or discontinue products without prior notice.
              </p>
            </div>

            {/* Section 3 */}
            <div className="space-y-4 pt-4 border-t border-black/5">
              <h2 className="font-dm text-2xl sm:text-3xl text-black tracking-[-0.03em] flex items-center gap-3">
                <Award className="w-6 h-6 text-emerald-800 shrink-0" /> 3. Health Disclaimer
              </h2>
              <p className="font-inter text-sm sm:text-base text-black/65 leading-relaxed">
                Statements on this site regarding our shade-dried moringa powder and tablets have not been evaluated by the FSSAI or FDA to diagnose, treat, cure, or prevent any disease. Our products are organic dietary supplements intended to support daily wellness.
              </p>
            </div>

            {/* Section 4 */}
            <div className="space-y-4 pt-4 border-t border-black/5">
              <h2 className="font-dm text-2xl sm:text-3xl text-black tracking-[-0.03em] flex items-center gap-3">
                <ShieldAlert className="w-6 h-6 text-emerald-800 shrink-0" /> 4. Intellectual Property
              </h2>
              <p className="font-inter text-sm sm:text-base text-black/65 leading-relaxed">
                All content, logos, photography, and graphics are the exclusive property of Earthora Farms Pvt. Ltd. Unauthorized reproduction or commercial use is strictly prohibited.
              </p>
            </div>

          </div>

        </div>
      </section>

      <Footer />
    </div>
  );
}
