import { motion, type Variants } from "framer-motion";
import { Sun, Shield, Brain, Leaf, Sparkles, Activity } from "lucide-react";

const benefits = [
  { icon: Sun, title: "Sustained Energy", desc: "No spikes. No crashes. Just smooth, natural vitality that lasts all day." },
  { icon: Shield, title: "Immune Support", desc: "Packed with antioxidants and essential vitamins to fortify your defenses." },
  { icon: Brain, title: "Cognitive Clarity", desc: "Nourish your brain with iron and zinc for sharper focus and memory." },
  { icon: Sparkles, title: "Cellular Glow", desc: "Rich in Vitamin E and A to promote healthy, radiant skin from within." },
  { icon: Activity, title: "Metabolic Harmony", desc: "Supports natural digestion and metabolic balance naturally." },
  { icon: Leaf, title: "Pure Alkalinity", desc: "Balances body pH, reducing acidity with deep green nutrition." }
];

const containerVars: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVars: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] as const } }
};

export function Benefits() {
  return (
    <section id="benefits" className="py-24 md:py-32 bg-secondary/30">
      <div className="container mx-auto px-6 max-w-6xl">
        <div className="text-center max-w-2xl mx-auto mb-20">
          <h2 className="text-4xl md:text-5xl font-serif text-foreground mb-6">Total Body Vitality</h2>
          <p className="text-foreground/70 font-light text-lg">
            Moringa isn't just an ingredient—it's a comprehensive nutritional foundation.
          </p>
        </div>

        <motion.div
          variants={containerVars}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-16"
        >
          {benefits.map((benefit, i) => (
            <motion.div key={i} variants={itemVars} className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-card flex items-center justify-center text-primary mb-6 shadow-sm">
                <benefit.icon strokeWidth={1.5} className="w-8 h-8" />
              </div>
              <h4 className="text-xl font-serif text-foreground mb-3">{benefit.title}</h4>
              <p className="text-foreground/70 font-light leading-relaxed">
                {benefit.desc}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
