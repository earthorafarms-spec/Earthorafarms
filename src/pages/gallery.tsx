import { motion, type Variants } from "framer-motion";
import { useState } from "react";
import { Maximize2, X, ChevronLeft, ChevronRight, Image as ImageIcon, Camera } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import leavesImg from "@assets/generated_images/hero_leaves.jpg";
import leavesImg2 from "@assets/generated_images/hero_leaves_2.jpg";
import farmFieldWide from "@assets/generated_images/farm_field_wide.png";
import farmLeavesCloseup from "@assets/generated_images/farm_leaves_closeup.png";
import farmHarvestWorkers from "@assets/generated_images/farm_harvest_workers.png";
import farmMoringaTree from "@assets/generated_images/farm_moringa_tree.png";
import farmSeedlings from "@assets/generated_images/farm_seedlings.png";
import farmSunsetAerial from "@assets/generated_images/farm_sunset_aerial.png";

const galleryItems = [
  { src: farmFieldWide, alt: "Wide view of our moringa farm at golden hour", title: "Volcanic Fields", tag: "Farm Life" },
  { src: leavesImg, alt: "Sunlit moringa leaves swaying in the breeze", title: "Sunlit Foliage", tag: "Harvest" },
  { src: farmHarvestWorkers, alt: "Farmers hand-harvesting fresh moringa leaves", title: "Hand Harvesting", tag: "Craft" },
  { src: farmLeavesCloseup, alt: "Close-up of dewy moringa leaves in the morning", title: "Morning Dew", tag: "Purity" },
  { src: farmMoringaTree, alt: "A mature moringa tree standing tall on the farm", title: "Tree of Life", tag: "Botanical" },
  { src: leavesImg2, alt: "Cluster of vibrant green moringa leaves", title: "Vibrant Greens", tag: "Organic" },
  { src: farmSeedlings, alt: "Young moringa seedlings in our farm nursery", title: "Nursery Care", tag: "Growth" },
  { src: farmSunsetAerial, alt: "Aerial view of the farm stretching at sunset", title: "Golden Horizon", tag: "Aerial" },
];

const containerVars: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVars: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
};

import { useEscapeKey } from "@/hooks/useEscapeKey";

export default function Gallery() {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEscapeKey(() => setLightboxIndex(null), lightboxIndex !== null);

  const prev = () =>
    setLightboxIndex((i) => (i !== null ? (i - 1 + galleryItems.length) % galleryItems.length : 0));
  const next = () =>
    setLightboxIndex((i) => (i !== null ? (i + 1) % galleryItems.length : 0));

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
      <Navbar />

      {/* ── UNIQUE HERO: Visual Banner Hero with Overlaid Glassmorphism Card ── */}
      <section className="relative pt-28 lg:pt-32 pb-12 lg:pb-16 overflow-hidden">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="relative h-[320px] sm:h-[400px] lg:h-[460px] rounded-3xl overflow-hidden shadow-2xl">
            {/* Background Image */}
            <img
              src={farmSunsetAerial}
              alt="Farm Aerial View"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0F2318]/90 via-[#0F2318]/60 to-transparent" />

            {/* Overlaid Floating Card */}
            <div className="absolute bottom-8 left-8 right-8 sm:left-12 sm:bottom-12 max-w-xl text-white">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/15 backdrop-blur-md border border-white/20 font-dm font-medium text-xs text-white uppercase tracking-wider mb-4"
              >
                <Camera className="w-3.5 h-3.5 text-amber-300" />
                <span>Visual Journal</span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="font-dm font-normal text-3xl sm:text-5xl lg:text-6xl text-white tracking-[-0.04em] leading-tight mb-3"
              >
                Life on the Farm
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="font-inter text-sm sm:text-base text-white/75 leading-relaxed"
              >
                A glimpse into our living volcanic fields where we care for our moringa trees from seedling to sun-dried harvest.
              </motion.p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Gallery Grid ── */}
      <section className="py-12 lg:py-16">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <motion.div
            variants={containerVars}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="columns-1 sm:columns-2 lg:columns-3 gap-6 space-y-6"
          >
            {galleryItems.map((item, i) => (
              <motion.div
                key={i}
                variants={itemVars}
                className="break-inside-avoid group relative rounded-2xl overflow-hidden cursor-pointer bg-[#FEFDF9] border border-black/5 shadow-sm hover:shadow-2xl transition-all duration-500"
                onClick={() => setLightboxIndex(i)}
              >
                <img
                  src={item.src}
                  alt={item.alt}
                  className="w-full h-auto object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                />
                
                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 p-6 flex flex-col justify-between">
                  <div className="self-end">
                    <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md text-white flex items-center justify-center">
                      <Maximize2 className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <span className="font-inter text-xs text-amber-300 font-medium uppercase tracking-wider block mb-1">
                      {item.tag}
                    </span>
                    <h3 className="font-dm text-xl text-white tracking-[-0.02em]">
                      {item.title}
                    </h3>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Lightbox Modal ── */}
      {lightboxIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 sm:p-8 selection:bg-white selection:text-black animate-fade-in">
          <button
            type="button"
            onClick={() => setLightboxIndex(null)}
            className="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-colors z-50"
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>

          <button
            type="button"
            onClick={prev}
            className="absolute left-4 sm:left-8 w-12 h-12 rounded-full bg-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-colors z-50"
            aria-label="Previous image"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <button
            type="button"
            onClick={next}
            className="absolute right-4 sm:right-8 w-12 h-12 rounded-full bg-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-colors z-50"
            aria-label="Next image"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          <div className="max-w-5xl max-h-[85vh] relative flex flex-col items-center">
            <img
              src={galleryItems[lightboxIndex].src}
              alt={galleryItems[lightboxIndex].alt}
              className="max-w-full max-h-[75vh] object-contain rounded-2xl shadow-2xl"
            />
            <div className="mt-6 text-center">
              <h3 className="font-dm text-2xl text-white tracking-[-0.03em] mb-1">
                {galleryItems[lightboxIndex].title}
              </h3>
              <p className="font-inter text-sm text-white/60">
                {galleryItems[lightboxIndex].alt}
              </p>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
