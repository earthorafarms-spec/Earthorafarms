import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import heroBg from "@assets/generated_images/hero_leaves.jpg";
import { Button } from "@/components/ui/button";

export function Hero() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"]
  });

  const y = useTransform(scrollYProgress, [0, 1], ["0%", "40%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section ref={ref} className="relative h-[100dvh] flex items-center justify-center overflow-hidden bg-primary">
      <motion.div style={{ y, opacity }} className="absolute inset-0 z-0 scale-105">
        <div className="absolute inset-0 bg-black/40 z-10 mix-blend-multiply" />
        <img src={heroBg} alt="Vibrant sunlit moringa leaves" className="w-full h-full object-cover" />
      </motion.div>

      <div className="relative z-10 text-center px-6 max-w-5xl mx-auto flex flex-col items-center mt-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          className="mb-6 inline-flex items-center rounded-full border border-primary-foreground/30 bg-primary-foreground/10 px-4 py-1.5 text-sm text-primary-foreground backdrop-blur-md"
        >
          Pure. Potent. Alive.
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
          className="text-5xl md:text-7xl lg:text-8xl font-serif font-medium text-primary-foreground leading-[1.1] tracking-tight mb-6"
        >
          The Ancient Tree of Life.
          <br />
          <span className="text-secondary/90 italic">Reimagined for Today.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
          className="text-lg md:text-xl text-primary-foreground/80 max-w-2xl mb-10 font-light"
        >
          Experience the unmatched vitality of nature's most nutrient-dense botanical. Grown in the sun, crafted for your daily ritual.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.8 }}
          className="flex flex-col sm:flex-row gap-4"
        >
          <Button size="lg" className="bg-primary-foreground text-primary hover:bg-secondary border-none">
            Shop the Collection
          </Button>
          <Button size="lg" variant="outline" className="text-primary-foreground border-primary-foreground hover:bg-primary-foreground hover:text-primary">
            Explore the Origins
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
