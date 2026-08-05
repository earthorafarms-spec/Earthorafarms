import { motion } from "framer-motion";
import { ArrowUpRight, Sparkles, Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchPublicProducts } from "@/lib/api";
import type { Product } from "@/types";
import powderImg from "@assets/generated_images/product_powder.jpg";

export function Products() {
  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["public-products"],
    queryFn: fetchPublicProducts,
    staleTime: 1000 * 60 * 5,
  });

  const tagColors = [
    "bg-black text-white",
    "bg-[#ECEDEC] text-black border border-black/10",
    "bg-emerald-900 text-white",
  ];

  if (isLoading) {
    return (
      <section id="products" className="py-24 lg:py-36 bg-[#F4F3EE] relative overflow-hidden text-black">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] text-center">
          <p className="text-black/50 font-inter">Loading our botanical collection...</p>
        </div>
      </section>
    );
  }

  return (
    <section id="products" className="py-24 lg:py-36 bg-[#F4F3EE] relative overflow-hidden text-black selection:bg-black selection:text-white">
      {/* Background Subtle Grid Pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:32px_32px] opacity-[0.03] pointer-events-none" />

      <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10">
        {/* Section Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 mb-16 lg:mb-24">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl"
          >
            <div className="mb-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/5 border border-black/10 font-dm font-medium text-xs sm:text-sm text-black/80 tracking-[0.05em] uppercase">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>The Collection</span>
            </div>

            <h2 className="font-dm font-normal tracking-[-0.04em] text-[40px] leading-[44px] sm:text-[60px] sm:leading-[58px] lg:text-[76px] lg:leading-[72px] text-black">
              Three ways to thrive. <br />
              <span className="text-black/40">Uncompromised potency.</span>
            </h2>
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
            className="font-inter font-normal text-base sm:text-lg text-black/70 max-w-[360px] leading-[1.5] tracking-[-0.02em]"
          >
            However you craft your daily wellness ritual, experience the same bio-available vitality and pure green power.
          </motion.p>
        </div>

        {/* Product Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-10">
          {products.map((product, index) => {
            const badge = product.badge || product.tag || "Pure Leaf";
            const tagColor = tagColors[index % tagColors.length];
            const subtitle = product.highlights?.[0] || "100% Organic Supplement";

            return (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.9,
                  delay: index * 0.15,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="group bg-[#FEFDF9] rounded-2xl border border-black/5 p-6 lg:p-7 flex flex-col justify-between shadow-sm hover:shadow-2xl transition-all duration-500 hover:-translate-y-1.5 cursor-pointer"
                onClick={() => { window.location.href = "/our-product"; }}
              >
                <div>
                  {/* Product Image Container */}
                  <div className="relative aspect-square rounded-xl overflow-hidden bg-[#ECEDEC] mb-6 flex items-center justify-center p-6">
                    {/* Badge */}
                    <span
                      className={`absolute top-4 left-4 px-3.5 py-1.5 rounded-full font-inter font-medium text-xs tracking-[-0.01em] shadow-sm z-10 ${tagColor}`}
                    >
                      {badge}
                    </span>

                    <img
                      src={product.imageMain || powderImg}
                      alt={product.name}
                      className="w-full h-full object-cover rounded-lg shadow-md group-hover:scale-105 transition-transform duration-700 ease-out"
                    />
                  </div>

                  {/* Rating & Reviews */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex items-center text-amber-500">
                      <Star className="w-4 h-4 fill-current" />
                    </div>
                    <span className="font-inter font-medium text-sm text-black">
                      {product.rating || "4.8"}
                    </span>
                    <span className="font-inter text-xs text-black/40">
                      ({product.reviewCount || "120"} reviews)
                    </span>
                  </div>

                  {/* Title & Subtitle */}
                  <h3 className="font-dm font-normal text-2xl lg:text-3xl text-black tracking-[-0.03em] leading-tight mb-1">
                    {product.name}
                  </h3>
                  <p className="font-inter text-xs uppercase tracking-wider text-black/40 font-medium mb-4">
                    {subtitle}
                  </p>

                  {/* Description */}
                  <p className="font-inter text-sm text-black/70 leading-relaxed tracking-[-0.02em] mb-6 line-clamp-3">
                    {product.description}
                  </p>
                </div>

                {/* Clean View Details Link */}
                <div className="pt-5 border-t border-black/10 flex items-center justify-between mt-auto text-black font-inter font-medium text-sm group-hover:text-emerald-800 transition-colors">
                  <span>View Product Details</span>
                  <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
