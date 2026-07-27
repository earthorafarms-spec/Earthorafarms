import { motion } from "framer-motion";
import { ArrowUpRight, Sparkles, ShieldCheck, Truck, RefreshCw } from "lucide-react";

export function CTA() {
  return (
    <section className="relative py-28 lg:py-40 overflow-hidden bg-black text-white selection:bg-white selection:text-black">
      {/* Ambient background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_0,transparent_75%)] pointer-events-none" />

      <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-4xl mx-auto"
        >
          <div className="mb-6 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 font-dm font-medium text-xs sm:text-sm text-white/90 tracking-[0.05em] uppercase backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Begin Your Journey</span>
          </div>

          <h2 className="font-dm font-normal tracking-[-0.05em] text-[48px] leading-[50px] sm:text-[72px] sm:leading-[68px] lg:text-[96px] lg:leading-[88px] text-white mb-8">
            Ready to feel alive?
          </h2>

          <p className="font-inter font-normal text-base sm:text-xl text-white/70 max-w-2xl mx-auto leading-relaxed tracking-[-0.02em] mb-12">
            Join over 14,000+ individuals who have transformed their morning ritual with TerraElix's pure botanical strength.
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center max-w-md mx-auto sm:max-w-none mb-16">
            <a
              href="/products"
              className="bg-white text-black hover:bg-white/90 w-full sm:w-auto h-14 sm:h-16 px-8 rounded-xl font-inter font-medium text-base sm:text-lg tracking-[-0.02em] flex items-center justify-center gap-2 shadow-2xl transition-all group"
            >
              <span>Shop The Collection</span>
              <ArrowUpRight className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </a>
            <a
              href="/contact"
              className="border border-white/20 hover:border-white/40 text-white w-full sm:w-auto h-14 sm:h-16 px-8 rounded-xl font-inter font-medium text-base sm:text-lg tracking-[-0.02em] flex items-center justify-center gap-2 transition-all hover:bg-white/5"
            >
              <span>Explore Benefits</span>
            </a>
          </div>

          {/* Trust Guarantees */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-12 border-t border-white/10 max-w-3xl mx-auto text-left sm:text-center font-inter text-xs text-white/60">
            <div className="flex items-center sm:justify-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>30-Day Pure Quality Guarantee</span>
            </div>
            <div className="flex items-center sm:justify-center gap-2">
              <Truck className="w-4 h-4 text-amber-300 shrink-0" />
              <span>Free Express Shipping</span>
            </div>
            <div className="flex items-center sm:justify-center gap-2">
              <RefreshCw className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Cancel Subscription Anytime</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
