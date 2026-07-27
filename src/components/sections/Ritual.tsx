import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { ArrowUpRight, CheckCircle2, Clock } from "lucide-react";
import smoothieImg from "@assets/generated_images/lifestyle_smoothie.jpg";

export function Ritual() {
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  const y = useTransform(scrollYProgress, [0, 1], ["-8%", "8%"]);

  return (
    <section
      id="ritual"
      ref={containerRef}
      className="py-24 lg:py-36 bg-[#F4F3EE] overflow-hidden text-black selection:bg-black selection:text-white relative"
    >
      <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Image Column */}
          <div className="lg:col-span-6 relative h-[500px] sm:h-[600px] lg:h-[680px] rounded-3xl overflow-hidden shadow-2xl border border-black/5">
            <motion.div style={{ y }} className="absolute inset-0 w-full h-[120%] -top-[10%]">
              <img
                src={smoothieImg}
                alt="Morning Moringa Ritual Smoothie"
                className="w-full h-full object-cover"
              />
            </motion.div>

            {/* Overlaid Floating Ritual Pill */}
            <div className="absolute bottom-6 left-6 right-6 sm:left-8 sm:right-auto bg-black/85 backdrop-blur-md text-white p-5 rounded-2xl border border-white/10 shadow-2xl max-w-sm">
              <div className="flex items-center gap-3 mb-1">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="font-dm text-sm font-medium tracking-wide">60-Second Ritual</span>
              </div>
              <p className="font-inter text-xs text-white/70 leading-relaxed">
                Effortless daily green habit. Stir into cold water, whisk into tea, or blend with your morning smoothie.
              </p>
            </div>
          </div>

          {/* Content Column */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-6"
          >
            <div className="mb-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/5 border border-black/10 font-dm font-medium text-xs sm:text-sm text-black/80 tracking-[0.05em] uppercase">
              <Clock className="w-3.5 h-3.5 text-emerald-800" />
              <span>The Morning Ritual</span>
            </div>

            <h2 className="font-dm font-normal tracking-[-0.04em] text-[40px] leading-[44px] sm:text-[60px] sm:leading-[58px] lg:text-[76px] lg:leading-[72px] text-black mb-8">
              Elevate your <br />
              <span className="text-black/40">everyday wellness.</span>
            </h2>

            <p className="font-inter font-normal text-base sm:text-lg text-black/70 leading-[1.6] tracking-[-0.02em] mb-8">
              Replace the jittery caffeine crash with the smooth, sustained vitality of raw plant nutrition. TerraElix grounds your morning routine in nature's purest energy.
            </p>

            <ul className="space-y-4 mb-10 font-inter text-base text-black/80">
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                <span>Takes less than 60 seconds to prepare</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                <span>Highly bioavailable and fast-absorbing formula</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                <span>Pairs beautifully with citrus, ginger, and plant milks</span>
              </li>
            </ul>

            <a
              href="/recipes"
              className="bg-black text-white px-8 py-4 rounded-xl font-inter font-medium text-base tracking-[-0.02em] inline-flex items-center gap-2 hover:bg-black/85 transition-all shadow-xl group"
            >
              <span>Explore Wellness Recipes</span>
              <ArrowUpRight className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
