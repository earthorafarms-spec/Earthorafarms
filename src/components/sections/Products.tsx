import { motion } from "framer-motion";
import { ArrowUpRight, Sparkles, Star } from "lucide-react";
import powderImg from "@assets/generated_images/product_powder.jpg";
import tabletsImg from "@assets/generated_images/product_tablets.jpg";
import capsulesImg from "@assets/generated_images/product_capsules.jpg";

const products = [
  {
    id: "capsules",
    name: "Moringa Elixir Capsules",
    subtitle: "Daily Vitality & Balance",
    description:
      "Quick & Essential. 100% pure shade-dried leaf powder encased in plant-based vegan capsules for clean energy on the go.",
    rating: "4.9",
    reviews: "1,240",
    image: capsulesImg,
    badge: "Best Seller",
    tagColor: "bg-emerald-800 text-white",
  },
  {
    id: "powder",
    name: "Pure Moringa Leaf Powder",
    subtitle: "Raw Botanical Superfood",
    description:
      "Raw & Potent. Ultra-fine vibrant green powder crafted for smoothies, elixirs, and daily culinary wellness rituals.",
    rating: "4.8",
    reviews: "980",
    image: powderImg,
    badge: "Most Popular",
    tagColor: "bg-black text-white",
  },
  {
    id: "tablets",
    name: "Organic Moringa Tablets",
    subtitle: "100% Cold-Pressed Leaves",
    description:
      "Pure & Convenient. Gently compressed leaf tablets entirely free of synthetic binders, fillers, or coating agents.",
    rating: "4.9",
    reviews: "750",
    image: tabletsImg,
    badge: "New Formula",
    tagColor: "bg-[#ECEDEC] text-black border border-black/10",
  },
];

export function Products() {
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
          {products.map((product, index) => (
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
                    className={`absolute top-4 left-4 px-3.5 py-1.5 rounded-full font-inter font-medium text-xs tracking-[-0.01em] shadow-sm z-10 ${product.tagColor}`}
                  >
                    {product.badge}
                  </span>

                  <img
                    src={product.image}
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
                    {product.rating}
                  </span>
                  <span className="font-inter text-xs text-black/40">
                    ({product.reviews} reviews)
                  </span>
                </div>

                {/* Title & Subtitle */}
                <h3 className="font-dm font-normal text-2xl lg:text-3xl text-black tracking-[-0.03em] leading-tight mb-1">
                  {product.name}
                </h3>
                <p className="font-inter text-xs uppercase tracking-wider text-black/40 font-medium mb-4">
                  {product.subtitle}
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
          ))}
        </div>
      </div>
    </section>
  );
}
