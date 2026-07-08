import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import smoothieImg from "@assets/generated_images/lifestyle_smoothie.jpg";
import { Button } from "@/components/ui/button";

export function Ritual() {
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"]
  });

  const y = useTransform(scrollYProgress, [0, 1], ["-10%", "10%"]);

  return (
    <section id="ritual" ref={containerRef} className="py-24 md:py-32 bg-background overflow-hidden">
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
          <div className="order-2 lg:order-1 relative h-[600px] rounded-3xl overflow-hidden">
            <motion.div style={{ y }} className="absolute inset-0 w-full h-[120%] -top-[10%]">
              <img src={smoothieImg} alt="Morning Moringa Ritual" className="w-full h-full object-cover" />
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            className="order-1 lg:order-2"
          >
            <h2 className="text-sm font-medium uppercase tracking-widest text-primary mb-4">The Morning Ritual</h2>
            <h3 className="text-4xl md:text-6xl font-serif text-foreground mb-8 leading-tight">
              Elevate your <br/> everyday.
            </h3>
            <p className="text-foreground/70 font-light text-lg mb-8 leading-relaxed">
              Replace the jittery crash of coffee with the sustained, natural vitality of pure green energy. Whether stirred into a morning smoothie, whisked into warm water, or taken on the go, Moringa Vita grounds your day in nature's brilliance.
            </p>
            <ul className="space-y-4 mb-10 text-foreground/80">
              <li className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>Takes less than 60 seconds</span>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>Bioavailable and highly absorbable</span>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>Pairs beautifully with citrus and ginger</span>
              </li>
            </ul>
            <Button size="lg">Explore Recipes</Button>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
