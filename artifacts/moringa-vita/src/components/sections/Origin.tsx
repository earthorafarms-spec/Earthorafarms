import { motion } from "framer-motion";
import leafImg from "@assets/generated_images/hero_leaves.jpg";

export function Origin() {
  return (
    <section id="origins" className="py-24 md:py-32 bg-background relative overflow-hidden">
      <div className="container mx-auto px-6 max-w-6xl">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            className="relative aspect-[4/5] rounded-2xl overflow-hidden"
          >
            <div className="absolute inset-0 bg-primary/10 mix-blend-multiply z-10" />
            <img src={leafImg} alt="Moringa Leaf Detail" className="w-full h-full object-cover scale-110" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          >
            <h2 className="text-sm font-medium uppercase tracking-widest text-primary mb-6">The Miracle Tree</h2>
            <h3 className="text-4xl md:text-5xl font-serif text-foreground mb-8 leading-tight">
              Rooted in ancient soil. <br/> Grown for modern vitality.
            </h3>
            <div className="space-y-6 text-foreground/70 font-light text-lg">
              <p>
                Grown in nutrient-dense volcanic soils, our Moringa oleifera is gently shade-dried to preserve its vibrant green color and potent life force.
              </p>
              <p>
                A single leaf holds decades of ancient wisdom, offering more complete nutrition and sustained energy than almost any other botanical on earth. We capture that purity without compromise.
              </p>
            </div>
            <div className="mt-12 pt-12 border-t border-border grid grid-cols-2 gap-8">
              <div>
                <div className="text-3xl font-serif text-primary mb-2">100%</div>
                <div className="text-sm text-foreground/60 uppercase tracking-wider">Organic & Pure</div>
              </div>
              <div>
                <div className="text-3xl font-serif text-primary mb-2">0</div>
                <div className="text-sm text-foreground/60 uppercase tracking-wider">Additives</div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
