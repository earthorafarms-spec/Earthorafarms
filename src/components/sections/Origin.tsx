import { motion } from "framer-motion";
import { ArrowUpRight, Leaf, ShieldCheck, Sparkles, Sun } from "lucide-react";
import leafImg from "@assets/generated_images/hero_leaves.jpg";

export function Origin() {
  return (
    <section id="origins" className="py-24 lg:py-36 bg-[#FAF9F5] relative overflow-hidden text-black selection:bg-black selection:text-white">
      {/* Subtle ambient gradient overlay matching natural warm mood */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(215,232,184,0.3)_0%,transparent_70%)] pointer-events-none" />

      <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10">
        {/* Section Tag */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/5 border border-black/10 font-dm font-medium text-xs sm:text-sm text-black/80 tracking-[0.05em] uppercase"
        >
          <Leaf className="w-3.5 h-3.5 text-emerald-800" />
          <span>The Miracle Tree</span>
        </motion.div>

        {/* Headline + Sub-intro Grid */}
        <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-end mb-16 lg:mb-24">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            className="lg:col-span-8"
          >
            <h2 className="font-dm font-normal tracking-[-0.04em] text-[40px] leading-[44px] sm:text-[64px] sm:leading-[62px] md:text-[84px] md:leading-[78px] text-black">
              Rooted in ancient soil. <br />
              <span className="text-black/40">Grown for modern vitality.</span>
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
            className="lg:col-span-4"
          >
            <p className="font-inter font-normal text-base sm:text-lg text-black/70 leading-[1.5] tracking-[-0.02em] mb-6">
              A single leaf holds centuries of botanical wisdom, offering more complete nutrition and sustained clean energy than almost any other plant on earth.
            </p>
            <a
              href="#about"
              className="inline-flex items-center gap-2 font-inter font-medium text-base tracking-[-0.02em] text-black hover:opacity-75 transition-opacity underline underline-offset-4"
            >
              <span>Learn Our Harvest Process</span>
              <ArrowUpRight className="w-4 h-4" />
            </a>
          </motion.div>
        </div>

        {/* Feature Cards Grid (Hero Panel-inspired design system) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {/* Card 1: Visual Image Highlight */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
            className="group relative rounded-2xl overflow-hidden aspect-[4/5] bg-black shadow-xl"
          >
            <img
              src={leafImg}
              alt="Moringa Leaves Detail"
              className="w-full h-full object-cover opacity-85 group-hover:scale-105 transition-transform duration-700 ease-out"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent p-6 lg:p-8 flex flex-col justify-between">
              <span className="self-start px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-white font-inter text-xs tracking-wider uppercase font-medium">
                Sun-Dried Organic
              </span>
              <div>
                <h3 className="font-dm text-2xl lg:text-3xl text-white tracking-[-0.03em] mb-2 font-normal">
                  Nutrient-Dense Foliage
                </h3>
                <p className="font-inter text-sm text-white/70 leading-relaxed tracking-[-0.02em]">
                  Gently harvested at peak sunlight to preserve vital enzymes and raw chlorophyll.
                </p>
              </div>
            </div>
          </motion.div>

          {/* Card 2: Light High-Impact Panel */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
            className="bg-[#ECEDEC] rounded-2xl p-8 lg:p-10 flex flex-col justify-between border border-black/5 shadow-sm min-h-[380px]"
          >
            <div>
              <div className="w-12 h-12 rounded-full bg-black text-white flex items-center justify-center mb-8 shadow-md">
                <Sun className="w-6 h-6 text-amber-300" />
              </div>
              <h3 className="font-dm font-normal text-3xl lg:text-4xl text-black tracking-[-0.04em] leading-tight mb-4">
                100% Volcanic Soil Grown
              </h3>
              <p className="font-inter text-black/70 text-base leading-relaxed tracking-[-0.02em]">
                Cultivated in rich, bio-active volcanic earth where natural minerals feed every cellular structure naturally.
              </p>
            </div>

            <div className="pt-6 border-t border-black/10 flex items-center justify-between font-inter text-xs text-black/60 tracking-wider uppercase font-medium">
              <span>Bio-Active Matrix</span>
              <span className="font-dm text-black font-medium text-lg">90+ Nutrients</span>
            </div>
          </motion.div>

          {/* Card 3: Dark High-Impact Panel */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.5 }}
            className="bg-black text-white rounded-2xl p-8 lg:p-10 flex flex-col justify-between shadow-2xl min-h-[380px]"
          >
            <div>
              <div className="w-12 h-12 rounded-full bg-white/15 text-white flex items-center justify-center mb-8 backdrop-blur-md">
                <ShieldCheck className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="font-dm font-normal text-3xl lg:text-4xl text-white tracking-[-0.04em] leading-tight mb-4">
                Zero Additives. Ever.
              </h3>
              <p className="font-inter text-white/70 text-base leading-relaxed tracking-[-0.02em]">
                Uncompromised purity. Free from synthetic fillers, binders, heavy metals, or artificial preservatives.
              </p>
            </div>

            <div className="pt-6 border-t border-white/15 flex items-center justify-between font-inter text-xs text-white/60 tracking-wider uppercase font-medium">
              <span>Purity Standard</span>
              <span className="font-dm text-white font-medium text-lg">100% Raw</span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
