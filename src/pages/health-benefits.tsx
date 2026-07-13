import { motion, type Variants } from "framer-motion";
import { Link } from "wouter";
import { Sun, Shield, Brain, Leaf, Sparkles, Activity, Heart, BarChart3, Nut, Droplets, Wind, Apple } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import leavesImg from "@assets/generated_images/hero_leaves.jpg";
import smoothieImg from "@assets/generated_images/lifestyle_smoothie.jpg";

const keyBenefits = [
  { icon: Sun, title: "Sustained Energy", desc: "No spikes. No crashes. Moringa provides a steady release of natural energy through its rich iron, magnesium, and B-vitamin profile, supporting cellular energy production without stimulants." },
  { icon: Shield, title: "Immune Defense", desc: "Packed with vitamin C (7x more than oranges), zinc, and a dense array of antioxidants that fortify your immune system against oxidative stress and seasonal challenges." },
  { icon: Brain, title: "Cognitive Clarity", desc: "The iron, zinc, and vitamin E in moringa support neurotransmitter function and cerebral blood flow, promoting sharper focus, memory retention, and mental endurance." },
  { icon: Sparkles, title: "Cellular Radiance", desc: "Rich in vitamin E and A (4x more than carrots), moringa nourishes skin from within — supporting collagen production, reducing inflammation, and promoting a natural glow." },
  { icon: Activity, title: "Metabolic Balance", desc: "Natural chlorogenic acid and fiber help regulate blood sugar response, support healthy digestion, and maintain a balanced metabolism throughout the day." },
  { icon: Leaf, title: "Deep Alkalinity", desc: "Moringa's mineral-rich composition helps neutralize dietary acidity, supporting optimal pH balance and reducing the inflammatory burden on your body." },
];

const nutritionalHighlights = [
  { icon: Nut, label: "Protein", value: "2g per tsp", detail: "All 9 essential amino acids" },
  { icon: Heart, label: "Calcium", value: "4x milk", detail: "Bone & muscle support" },
  { icon: BarChart3, label: "Iron", value: "3x spinach", detail: "Oxygen transport & energy" },
  { icon: Droplets, label: "Potassium", value: "3x banana", detail: "Heart & nerve function" },
  { icon: Wind, label: "Vitamin C", value: "7x oranges", detail: "Immune & collagen" },
  { icon: Apple, label: "Vitamin A", value: "4x carrots", detail: "Vision & skin health" },
];

const containerVars: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const itemVars: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
};

export default function HealthBenefits() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/20">
      <Navbar />

      <section className="relative pt-40 pb-24 md:pt-48 md:pb-32 overflow-hidden bg-primary">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05)_0,transparent_70%)]" />
        <div className="container mx-auto px-6 max-w-7xl relative z-10">
          <div className="max-w-3xl">


            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="text-5xl md:text-7xl font-serif text-primary-foreground leading-[1.1] tracking-tight mb-6"
            >
              What makes moringa
              <br />
              <span className="text-secondary/90 italic">extraordinary.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="text-lg md:text-xl text-primary-foreground/80 font-light max-w-2xl"
            >
              For centuries, the moringa tree has been revered as a nutritional powerhouse. Modern science is only beginning to confirm what ancient healers have always known.
            </motion.p>
          </div>
        </div>
      </section>

      <section className="py-24 md:py-32 bg-background">
        <div className="container mx-auto px-6 max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center max-w-3xl mx-auto mb-20"
          >
            <h2 className="text-sm font-medium uppercase tracking-widest text-primary mb-4">The Science of Vitality</h2>
            <h3 className="text-4xl md:text-5xl font-serif text-foreground mb-6">Nature's Most Complete Nutrient Profile.</h3>
            <p className="text-foreground/70 font-light text-lg">
              Every gram of Earthora moringa delivers a remarkable concentration of vitamins, minerals, and antioxidants that work synergistically to support whole-body wellness.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-32">
            {nutritionalHighlights.map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                className="relative bg-card rounded-2xl p-8 border border-border/50"
              >
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-5">
                  <item.icon strokeWidth={1.5} className="w-6 h-6" />
                </div>
                <p className="text-xs font-medium uppercase tracking-wider text-foreground/40 mb-1">{item.label}</p>
                <p className="text-3xl font-serif text-foreground mb-1">{item.value}</p>
                <p className="text-sm text-foreground/60 font-light">{item.detail}</p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            className="relative rounded-3xl overflow-hidden bg-primary"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.05)_0,transparent_60%)]" />
            <div className="relative z-10 grid lg:grid-cols-2 gap-12 p-12 md:p-20 items-center">
              <div>
                <h3 className="text-3xl md:text-4xl font-serif text-primary-foreground mb-6 leading-tight">
                  More than the sum of its parts.
                </h3>
                <p className="text-primary-foreground/80 font-light text-lg leading-relaxed mb-6">
                  Unlike isolated supplements, moringa delivers a complete phytochemical matrix — nature's intended design where nutrients work together for optimal absorption and effect.
                </p>
                <ul className="space-y-3">
                  {["46 antioxidants in a single leaf", "9 essential amino acids", "Bioavailable plant-based iron", "Natural chlorogenic acid for glucose balance"].map((item) => (
                    <li key={item} className="flex items-center gap-3 text-primary-foreground/80">
                      <span className="w-1.5 h-1.5 rounded-full bg-secondary/80 flex-shrink-0" />
                      <span className="font-light">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="relative aspect-[4/3] rounded-2xl overflow-hidden">
                <img src={smoothieImg} alt="Moringa benefits" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/10" />
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="py-24 md:py-32 bg-secondary/30">
        <div className="container mx-auto px-6 max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center max-w-2xl mx-auto mb-20"
          >
            <h2 className="text-sm font-medium uppercase tracking-widest text-primary mb-4">Total Body Vitality</h2>
            <h3 className="text-4xl md:text-5xl font-serif text-foreground mb-6">How it works.</h3>
            <p className="text-foreground/70 font-light text-lg">
              Each of these benefits is rooted in the unique nutritional density of the moringa leaf — a single botanical that nourishes every system in the body.
            </p>
          </motion.div>

          <motion.div
            variants={containerVars}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-16"
          >
            {keyBenefits.map((benefit, i) => (
              <motion.div key={i} variants={itemVars} className="flex flex-col items-center text-center">
                <div className="w-16 h-16 rounded-full bg-card flex items-center justify-center text-primary mb-6 shadow-sm">
                  <benefit.icon strokeWidth={1.5} className="w-8 h-8" />
                </div>
                <h4 className="text-xl font-serif text-foreground mb-3">{benefit.title}</h4>
                <p className="text-foreground/70 font-light leading-relaxed">{benefit.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-24 md:py-32 bg-background">
        <div className="container mx-auto px-6 max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 className="text-4xl md:text-5xl font-serif text-foreground mb-6">Ready to experience the difference?</h2>
            <p className="text-foreground/70 font-light text-lg mb-10 max-w-2xl mx-auto">
              From the first serving, you'll notice a difference in how you feel — clearer mind, steadier energy, and a deep sense of well-being.
            </p>
            <Link href="/our-product">
              <Button size="lg" className="h-14 px-10 text-lg">
                Shop the Collection
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
