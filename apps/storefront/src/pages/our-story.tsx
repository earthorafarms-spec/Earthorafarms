import { motion } from "framer-motion";
import { Link } from "wouter";
import { Heart, Compass, Shield, Sprout, ArrowUpRight, Award } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

export default function OurStory() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
      <Navbar />

      {/* ── Split Hero Banner ── */}
      <section className="relative pt-36 pb-20 lg:pt-44 lg:pb-28 bg-[#0E0E0E] text-white overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05)_0,transparent_70%)] pointer-events-none" />
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 font-dm font-medium text-xs sm:text-sm text-white/80 tracking-[0.05em] uppercase backdrop-blur-md"
          >
            <Compass className="w-3.5 h-3.5 text-emerald-400" />
            <span>Our Roots & Heritage</span>
          </motion.div>

          <div className="grid lg:grid-cols-12 gap-8 items-end">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="lg:col-span-8"
            >
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[42px] leading-[44px] sm:text-[66px] sm:leading-[62px] lg:text-[84px] lg:leading-[78px] text-white">
                Rooted in everyday wellness. <br />
                <span className="text-white/35">Revitalized by Earthora.</span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="lg:col-span-4 font-inter font-normal text-base sm:text-lg text-white/55 leading-relaxed tracking-[-0.02em]"
            >
              Earthora Farms brings moringa leaf products into everyday wellness routines, with current product details available in our live collection.
            </motion.p>
          </div>
        </div>
      </section>

      {/* ── Section 1: The product approach ── */}
      <section className="py-20 lg:py-28">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-20 items-center">
            {/* Left Narrative */}
            <div className="lg:col-span-6 space-y-6">
              <span className="font-inter text-xs uppercase tracking-wider text-black/40 font-medium block">
                Our Approach
              </span>
              <h2 className="font-dm font-normal text-3xl sm:text-5xl text-black tracking-[-0.04em] leading-[1.1]">
                Make an informed choice.
              </h2>
              <p className="font-inter text-sm sm:text-base text-black/70 leading-relaxed">
                Our live product collection is the place to check what Earthora offers today. Each available product has its own description, price and directions so you can decide what suits your routine.
              </p>
              <p className="font-inter text-sm sm:text-base text-black/70 leading-relaxed">
                If you need more detail about sourcing, processing or batch documentation than the current label provides, contact our team and we will confirm what information is available.
              </p>
            </div>

            {/* Right Pillars Grid */}
            <div className="lg:col-span-6 grid sm:grid-cols-2 gap-6">
              <div className="p-8 rounded-3xl bg-[#FEFDF9] border border-black/5 space-y-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                  <Sprout className="w-5 h-5" />
                </div>
                <h3 className="font-dm text-lg text-black font-semibold">Current Product Details</h3>
                <p className="font-inter text-xs text-black/55 leading-relaxed">
                  See available products, pricing and stock in the live collection.
                </p>
              </div>

              <div className="p-8 rounded-3xl bg-[#FEFDF9] border border-black/5 space-y-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                  <Award className="w-5 h-5" />
                </div>
                <h3 className="font-dm text-lg text-black font-semibold">Label Information</h3>
                <p className="font-inter text-xs text-black/55 leading-relaxed">
                  Review each product label for its ingredients and directions.
                </p>
              </div>

              <div className="p-8 rounded-3xl bg-[#FEFDF9] border border-black/5 space-y-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                  <Shield className="w-5 h-5" />
                </div>
                <h3 className="font-dm text-lg text-black font-semibold">Questions Welcome</h3>
                <p className="font-inter text-xs text-black/55 leading-relaxed">
                  Ask our team if you need to verify an ingredient or batch detail.
                </p>
              </div>

              <div className="p-8 rounded-3xl bg-[#FEFDF9] border border-black/5 space-y-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                  <Heart className="w-5 h-5" />
                </div>
                <h3 className="font-dm text-lg text-black font-semibold">Order Support</h3>
                <p className="font-inter text-xs text-black/55 leading-relaxed">
                  Get help with product questions, checkout and order tracking.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 2: Timeline Story ── */}
      <section className="py-20 bg-[#FEFDF9] border-y border-black/5">
        <div className="container mx-auto px-6 sm:px-10 max-w-4xl text-center">
          <span className="font-inter text-xs uppercase tracking-wider text-black/40 font-medium block mb-3">
            Our Journey
          </span>
          <h2 className="font-dm font-normal text-3xl sm:text-5xl text-black tracking-[-0.04em] mb-12">
            Your journey, clearly explained.
          </h2>

          <div className="space-y-8 text-left max-w-2xl mx-auto">
            <div className="relative pl-8 border-l border-emerald-800/20 pb-4">
              <div className="absolute top-1.5 -left-1.5 w-3 h-3 rounded-full bg-emerald-800" />
              <span className="font-dm font-bold text-emerald-800 text-sm">Step 1: Explore</span>
              <p className="font-inter text-xs text-black/60 mt-1 leading-relaxed">
                Browse the live collection for currently available products.
              </p>
            </div>

            <div className="relative pl-8 border-l border-emerald-800/20 pb-4">
              <div className="absolute top-1.5 -left-1.5 w-3 h-3 rounded-full bg-emerald-800" />
              <span className="font-dm font-bold text-emerald-800 text-sm">Step 2: Review</span>
              <p className="font-inter text-xs text-black/60 mt-1 leading-relaxed">
                Read the product details and label directions before choosing.
              </p>
            </div>

            <div className="relative pl-8 border-l border-emerald-800/20 pb-4">
              <div className="absolute top-1.5 -left-1.5 w-3 h-3 rounded-full bg-emerald-800" />
              <span className="font-dm font-bold text-emerald-800 text-sm">Step 3: Ask</span>
              <p className="font-inter text-xs text-black/60 mt-1 leading-relaxed">
                Contact our team with any questions about ingredients or your order.
              </p>
            </div>

            <div className="relative pl-8">
              <div className="absolute top-1.5 -left-1.5 w-3 h-3 rounded-full bg-emerald-800" />
              <span className="font-dm font-bold text-emerald-800 text-sm">Step 4: Order</span>
              <p className="font-inter text-xs text-black/60 mt-1 leading-relaxed">
                Add a listed product to your cart and review your details at checkout.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA Banner ── */}
      <section className="py-24 text-center">
        <div className="container mx-auto px-6 max-w-2xl">
          <h2 className="font-dm text-4xl sm:text-5xl text-black tracking-[-0.04em] mb-4">
            Experience the difference.
          </h2>
          <p className="font-inter text-base text-black/60 leading-relaxed mb-8">
            Explore our current moringa products and choose the one that fits your routine.
          </p>
          <Link
            href="/#products"
            className="inline-flex items-center gap-2 bg-black text-white px-8 py-4 rounded-xl font-inter font-medium text-base hover:bg-black/85 transition-colors shadow-xl"
          >
            <span>Explore Collection</span>
            <ArrowUpRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
