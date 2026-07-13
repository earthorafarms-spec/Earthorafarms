import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import powderImg from "@assets/generated_images/product_powder.jpg";
import tabletsImg from "@assets/generated_images/product_tablets.jpg";
import capsulesImg from "@assets/generated_images/product_capsules.jpg";

const products = [
  {
    id: "powder",
    name: "Moringa Powder",
    description: "Raw & Potent. The versatile foundation for smoothies and culinary rituals.",
    image: powderImg,
    color: "bg-[#EAECE4]",
  },
  {
    id: "tablets",
    name: "Moringa Tablets",
    description: "Pure & Convenient. 100% pressed leaves, entirely free of binders.",
    image: tabletsImg,
    color: "bg-[#E6EBE6]",
  },
  {
    id: "capsules",
    name: "Moringa Capsules",
    description: "Quick & Essential. Your effortless daily dose of vitality on the go.",
    image: capsulesImg,
    color: "bg-[#EDE9E3]",
  }
];

export function Products() {
  return (
    <section id="formats" className="py-24 bg-card">
      <div className="container mx-auto px-6 max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8 }}
          className="text-center max-w-2xl mx-auto mb-20"
        >
          <h2 className="text-sm font-medium uppercase tracking-widest text-primary mb-4">The Collection</h2>
          <h3 className="text-4xl md:text-5xl font-serif text-foreground mb-6">Three ways to thrive.</h3>
          <p className="text-foreground/70 font-light text-lg">
            However you craft your ritual, experience the same uncompromised potency and pure green energy.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {products.map((product, index) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.8, delay: index * 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="group cursor-pointer"
            >
              <div className={`relative aspect-[4/5] rounded-2xl overflow-hidden mb-6 ${product.color} flex items-center justify-center p-8`}>
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-full h-full object-cover rounded-xl shadow-lg transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              </div>
              <h4 className="text-2xl font-serif text-foreground mb-3">{product.name}</h4>
              <p className="text-foreground/70 font-light mb-6 min-h-[60px]">{product.description}</p>
              <div className="flex items-center text-primary font-medium group-hover:text-accent transition-colors">
                <span>Shop {product.name}</span>
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
