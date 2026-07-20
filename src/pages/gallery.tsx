import { motion, type Variants } from "framer-motion";
import { useState } from "react";
import { Maximize2, X, ChevronLeft, ChevronRight } from "lucide-react";
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
  { src: farmFieldWide,       alt: "Wide view of our moringa farm at golden hour" },
  { src: leavesImg,           alt: "Sunlit moringa leaves swaying in the breeze" },
  { src: farmHarvestWorkers,  alt: "Farmers hand-harvesting fresh moringa leaves" },
  { src: farmLeavesCloseup,   alt: "Close-up of dewy moringa leaves in the morning" },
  { src: farmMoringaTree,     alt: "A mature moringa tree standing tall on the farm" },
  { src: leavesImg2,          alt: "Cluster of vibrant green moringa leaves" },
  { src: farmSeedlings,       alt: "Young moringa seedlings in our farm nursery" },
  { src: farmSunsetAerial,    alt: "Aerial view of the farm stretching at sunset" },
];

const containerVars: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } },
};

const itemVars: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] } },
};

export default function Gallery() {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const prev = () =>
    setLightboxIndex((i) => (i !== null ? (i - 1 + galleryItems.length) % galleryItems.length : 0));
  const next = () =>
    setLightboxIndex((i) => (i !== null ? (i + 1) % galleryItems.length : 0));

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/20">
      <Navbar />

      {/* Hero */}
      <section className="relative pt-40 pb-24 md:pt-48 md:pb-32 overflow-hidden bg-primary">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06)_0,transparent_70%)]" />
        <div className="container mx-auto px-6 max-w-7xl relative z-10">
          <div className="max-w-3xl">


            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="text-5xl md:text-7xl font-serif text-primary-foreground leading-[1.1] tracking-tight mb-6"
            >
              Life on the farm,
              <br />
              <span className="text-secondary/90 italic">in every frame.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="text-lg md:text-xl text-primary-foreground/80 font-light max-w-2xl"
            >
              A glimpse into the living fields where we grow and care for our moringa ΓÇö from seedling to harvest, rooted in nature.
            </motion.p>
          </div>
        </div>
      </section>

      {/* Gallery grid */}
      <section className="py-24 md:py-32 bg-background">
        <div className="container mx-auto px-6 max-w-7xl">
          <motion.div
            variants={containerVars}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-50px" }}
            className="columns-1 sm:columns-2 lg:columns-3 gap-5 space-y-5"
          >
            {galleryItems.map((item, i) => (
              <motion.div
                key={i}
                variants={itemVars}
                className="break-inside-avoid group relative rounded-2xl overflow-hidden cursor-pointer shadow-md hover:shadow-xl transition-shadow duration-500"
                onClick={() => setLightboxIndex(i)}
              >
                <img
                  src={item.src}
                  alt={item.alt}
                  className="w-full h-auto object-cover transition-transform duration-700 group-hover:scale-105"
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-center justify-center">
                  <div className="bg-white/90 backdrop-blur-sm rounded-full p-3 shadow-lg">
                    <Maximize2 className="w-5 h-5 text-foreground" strokeWidth={1.5} />
                  </div>
                </div>
                {/* Caption */}
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                  <p className="text-white text-sm font-light leading-snug">{item.alt}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-[100] bg-black/92 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Close */}
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-6 right-6 text-white/60 hover:text-white transition-colors z-10"
          >
            <X className="w-8 h-8" />
          </button>

          {/* Prev */}
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute left-4 md:left-8 text-white/60 hover:text-white transition-colors z-10"
          >
            <ChevronLeft className="w-9 h-9" />
          </button>

          {/* Next */}
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute right-4 md:right-8 text-white/60 hover:text-white transition-colors z-10"
          >
            <ChevronRight className="w-9 h-9" />
          </button>

          <motion.div
            key={lightboxIndex}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="max-w-5xl max-h-[85vh] mx-16"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={galleryItems[lightboxIndex].src}
              alt={galleryItems[lightboxIndex].alt}
              className="w-full h-full object-contain rounded-2xl"
            />
            <p className="text-white/70 text-center mt-4 text-sm font-light">
              {galleryItems[lightboxIndex].alt}
            </p>
            <p className="text-white/40 text-center mt-1 text-xs">
              {lightboxIndex + 1} / {galleryItems.length}
            </p>
          </motion.div>
        </div>
      )}

      <Footer />
    </div>
  );
}
