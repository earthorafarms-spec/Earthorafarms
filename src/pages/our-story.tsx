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
                Nurtured by volcanic soil. <br />
                <span className="text-white/35">Revitalized by Earthora.</span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="lg:col-span-4 font-inter font-normal text-base sm:text-lg text-white/55 leading-relaxed tracking-[-0.02em]"
            >
              Born from a vision to bridge ancient botanical wisdom with modern wellness, we cultivate organic Moringa oleifera at peak vitality.
            </motion.p>
          </div>
        </div>
      </section>

      {/* ── Section 1: The Ooty Farm ── */}
      <section className="py-20 lg:py-28">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-20 items-center">
            {/* Left Narrative */}
            <div className="lg:col-span-6 space-y-6">
              <span className="font-inter text-xs uppercase tracking-wider text-black/40 font-medium block">
                The Terroir
              </span>
              <h2 className="font-dm font-normal text-3xl sm:text-5xl text-black tracking-[-0.04em] leading-[1.1]">
                Nestled in the highlands of Ooty.
              </h2>
              <p className="font-inter text-sm sm:text-base text-black/70 leading-relaxed">
                Our farm sits on high-altitude, volcanic-ash enriched soil in Ooty, Tamil Nadu. The unique combination of cool mountain breeze, intense solar radiation, and mineral-rich natural spring water gives our moringa leaves an exceptionally high concentration of antioxidants, bioavailable vitamins, and active amino acids.
              </p>
              <p className="font-inter text-sm sm:text-base text-black/70 leading-relaxed">
                Unlike mass-commercial operations, we cultivate in micro-batches. Each tree is nurtured using natural, chemical-free composts, ensuring zero heavy-metal residues or toxic synthetic trace particles in our harvests.
              </p>
            </div>

            {/* Right Pillars Grid */}
            <div className="lg:col-span-6 grid sm:grid-cols-2 gap-6">
              <div className="p-8 rounded-3xl bg-[#FEFDF9] border border-black/5 space-y-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                  <Sprout className="w-5 h-5" />
                </div>
                <h3 className="font-dm text-lg text-black font-semibold">100% Organic Soil</h3>
                <p className="font-inter text-xs text-black/55 leading-relaxed">
                  Naturally fertilized soils enriched with mineral volcanic ash for supreme bioavailability.
                </p>
              </div>

              <div className="p-8 rounded-3xl bg-[#FEFDF9] border border-black/5 space-y-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                  <Award className="w-5 h-5" />
                </div>
                <h3 className="font-dm text-lg text-black font-semibold">Shade-Drying Mastery</h3>
                <p className="font-inter text-xs text-black/55 leading-relaxed">
                  Leaves dried in UV-protected shade chambers to preserve delicate chlorophyll and vital enzymes.
                </p>
              </div>

              <div className="p-8 rounded-3xl bg-[#FEFDF9] border border-black/5 space-y-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                  <Shield className="w-5 h-5" />
                </div>
                <h3 className="font-dm text-lg text-black font-semibold">Zero Additives</h3>
                <p className="font-inter text-xs text-black/55 leading-relaxed">
                  No binders, fillers, preservatives, or artificial flow agents. Pure botanical integrity.
                </p>
              </div>

              <div className="p-8 rounded-3xl bg-[#FEFDF9] border border-black/5 space-y-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                  <Heart className="w-5 h-5" />
                </div>
                <h3 className="font-dm text-lg text-black font-semibold">Direct Trade</h3>
                <p className="font-inter text-xs text-black/55 leading-relaxed">
                  Fair wages and premium working conditions for our local Ooty harvesting partners.
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
            Purity has a timeline.
          </h2>

          <div className="space-y-8 text-left max-w-2xl mx-auto">
            <div className="relative pl-8 border-l border-emerald-800/20 pb-4">
              <div className="absolute top-1.5 -left-1.5 w-3 h-3 rounded-full bg-emerald-800" />
              <span className="font-dm font-bold text-emerald-800 text-sm">Step 1: Dawn Harvest</span>
              <p className="font-inter text-xs text-black/60 mt-1 leading-relaxed">
                Leaves are hand-picked at dawn when nutrient density is at its highest, before the intense afternoon sun.
              </p>
            </div>

            <div className="relative pl-8 border-l border-emerald-800/20 pb-4">
              <div className="absolute top-1.5 -left-1.5 w-3 h-3 rounded-full bg-emerald-800" />
              <span className="font-dm font-bold text-emerald-800 text-sm">Step 2: Triple-Washing</span>
              <p className="font-inter text-xs text-black/60 mt-1 leading-relaxed">
                Leaves undergo sanitizing washes using RO purified water to remove environmental residues while retaining structure.
              </p>
            </div>

            <div className="relative pl-8 border-l border-emerald-800/20 pb-4">
              <div className="absolute top-1.5 -left-1.5 w-3 h-3 rounded-full bg-emerald-800" />
              <span className="font-dm font-bold text-emerald-800 text-sm">Step 3: Slow Dehydration</span>
              <p className="font-inter text-xs text-black/60 mt-1 leading-relaxed">
                Shade-dehydrated over 18 hours in temperature-controlled spaces, locking in green pigments and bio-actives.
              </p>
            </div>

            <div className="relative pl-8">
              <div className="absolute top-1.5 -left-1.5 w-3 h-3 rounded-full bg-emerald-800" />
              <span className="font-dm font-bold text-emerald-800 text-sm">Step 4: Milled & Sealed</span>
              <p className="font-inter text-xs text-black/60 mt-1 leading-relaxed">
                Milled into micro-fine particles and packed instantly into UV-blocking airtight pouches for ultimate freshness.
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
            Try our farm-fresh moringa powder or tablets, directly shipped from our botanical reserve.
          </p>
          <Link
            href="/our-product"
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
