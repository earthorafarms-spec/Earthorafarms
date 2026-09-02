import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Sun, Shield, Brain, Sparkles, Activity, Leaf, CheckCircle2 } from "lucide-react";

const benefits = [
  {
    num: "01",
    stat: "8h+",
    statLabel: "Lasting vitality",
    title: "Sustained Energy",
    desc: "No crashes. No spikes. Pure, steady cellular energy from morning through evening.",
    icon: Sun,
    accentColor: "from-amber-500/20 to-amber-500/5 text-amber-600 border-amber-500/20",
  },
  {
    num: "02",
    stat: "46x",
    statLabel: "Antioxidants",
    title: "Immune Support",
    desc: "Dense in antioxidants, quercetin, and essential vitamins to fortify your body's natural defenses daily.",
    icon: Shield,
    accentColor: "from-emerald-500/20 to-emerald-500/5 text-emerald-600 border-emerald-500/20",
  },
  {
    num: "03",
    stat: "18",
    statLabel: "Amino acids",
    title: "Cognitive Clarity",
    desc: "Plant-based iron and zinc nourish neural pathways for sharper focus, memory, and mental stamina.",
    icon: Brain,
    accentColor: "from-blue-500/20 to-blue-500/5 text-blue-600 border-blue-500/20",
  },
  {
    num: "04",
    stat: "90+",
    statLabel: "Nutrients",
    title: "Cellular Radiance",
    desc: "Vitamins A and E promote healthy skin regeneration and glowing complexion from within.",
    icon: Sparkles,
    accentColor: "from-purple-500/20 to-purple-500/5 text-purple-600 border-purple-500/20",
  },
  {
    num: "05",
    stat: "0",
    statLabel: "Additives",
    title: "Metabolic Harmony",
    desc: "Supports digestive balance, gut flora, and natural metabolic regulation without synthetic compounds.",
    icon: Activity,
    accentColor: "from-rose-500/20 to-rose-500/5 text-rose-600 border-rose-500/20",
  },
  {
    num: "06",
    stat: "100%",
    statLabel: "Organic",
    title: "Pure Alkalinity",
    desc: "Raw green chlorophyll gently balances body pH levels and counteracts chronic dietary acidity.",
    icon: Leaf,
    accentColor: "from-teal-500/20 to-teal-500/5 text-teal-600 border-teal-500/20",
  },
];

// Sub-component for individual card to safely call hooks unconditionally at top level
function BenefitCard({
  benefit,
  index,
  total,
  scrollYProgress,
}: {
  benefit: typeof benefits[0];
  index: number;
  total: number;
  scrollYProgress: any;
}) {
  const step = 1 / total;
  // Strictly clamp range values to ensure strictly non-decreasing order [0, 1]
  const p0 = Math.max(0, Math.min(1, (index - 0.5) * step));
  const p1 = Math.max(0, Math.min(1, index * step));
  const p2 = Math.max(0, Math.min(1, (index + 0.7) * step));
  const p3 = Math.max(0, Math.min(1, (index + 1) * step));

  const isFirst = index === 0;
  const isLast  = index === total - 1;
  const opacity = useTransform(scrollYProgress, [p0, p1, p2, p3], [isFirst ? 1 : 0, 1, 1, isLast ? 1 : 0]);
  const scale   = useTransform(scrollYProgress, [p0, p1, p2, p3], [isFirst ? 1 : 0.94, 1, 1, isLast ? 1 : 0.96]);
  const y       = useTransform(scrollYProgress, [p0, p1, p2, p3], [isFirst ? 0 : 40, 0, 0, isLast ? 0 : -30]);

  const Icon = benefit.icon;

  return (
    <motion.div
      style={{ opacity, scale, y }}
      className="absolute inset-0 flex items-center justify-center p-2 sm:p-6"
    >
      <div className="w-full max-w-4xl bg-[#FEFDF9] rounded-3xl border border-black/10 p-8 sm:p-12 lg:p-14 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8 relative overflow-hidden">
        {/* Subtle Background Radial Accent */}
        <div className={`absolute -right-20 -bottom-20 w-80 h-80 rounded-full bg-gradient-to-br ${benefit.accentColor} blur-3xl opacity-50 pointer-events-none`} />

        {/* Left Column: Stat & Number */}
        <div className="md:w-1/3 flex flex-col justify-between shrink-0">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-dm text-3xl font-normal text-black/25 tracking-[-0.05em]">
              {benefit.num}
            </span>
            <div className={`w-10 h-10 rounded-full border flex items-center justify-center ${benefit.accentColor}`}>
              <Icon className="w-5 h-5" />
            </div>
          </div>

          <div>
            <span className="font-dm font-normal text-6xl sm:text-7xl lg:text-8xl text-black tracking-[-0.05em] block leading-none mb-2">
              {benefit.stat}
            </span>
            <span className="font-inter text-xs sm:text-sm text-black/50 font-medium uppercase tracking-wider block">
              {benefit.statLabel}
            </span>
          </div>
        </div>

        {/* Right Column: Title & Full Description */}
        <div className="md:w-2/3 md:pl-8 md:border-l md:border-black/10 flex flex-col justify-between h-full">
          <div>
            <span className="inline-flex items-center gap-1.5 font-inter text-xs text-emerald-800 font-medium uppercase tracking-wider mb-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Clinically Observed</span>
            </span>

            <h3 className="font-dm font-normal text-3xl sm:text-4xl lg:text-5xl text-black tracking-[-0.04em] leading-tight mb-4">
              {benefit.title}
            </h3>

            <p className="font-inter font-normal text-base sm:text-lg text-black/75 leading-relaxed tracking-[-0.02em]">
              {benefit.desc}
            </p>
          </div>

          {/* Progress Indicator */}
          <div className="mt-8 pt-4 border-t border-black/8 flex items-center justify-between font-inter text-xs text-black/40">
            <span>Benefit {index + 1} of {total}</span>
            <div className="flex gap-1.5">
              {benefits.map((_, idx) => (
                <span
                  key={idx}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx === index ? "w-6 bg-black" : "w-1.5 bg-black/20"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function Benefits() {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  return (
    <section
      ref={containerRef}
      id="benefits"
      className="relative bg-[#FAF9F5] text-black selection:bg-black selection:text-white"
      style={{ height: `${benefits.length * 90}vh` }}
    >
      {/* Sticky Full-Viewport Stage */}
      <div className="sticky top-0 h-screen overflow-hidden flex flex-col justify-between py-10 lg:py-16 px-6 sm:px-10 max-w-[1400px] mx-auto w-full">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 z-20">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-black/5 border border-black/10 font-dm font-medium text-xs text-black/70 tracking-[0.05em] uppercase">
              <Activity className="w-3.5 h-3.5 text-emerald-800" />
              <span>Total Body Vitality</span>
            </div>
            <h2 className="font-dm font-normal tracking-[-0.04em] text-3xl sm:text-4xl lg:text-5xl text-black">
              More than a supplement. <span className="text-black/35">A complete foundation.</span>
            </h2>
          </div>

          <p className="font-inter text-xs sm:text-sm text-black/50 font-medium">
            Scroll to explore full cellular breakdown ↓
          </p>
        </div>

        {/* Center Stage */}
        <div className="relative flex-1 flex items-center justify-center my-6 z-10">
          {benefits.map((benefit, i) => (
            <BenefitCard
              key={i}
              benefit={benefit}
              index={i}
              total={benefits.length}
              scrollYProgress={scrollYProgress}
            />
          ))}
        </div>

        {/* Footer Bar */}
        <div className="z-20 pt-4 border-t border-black/10 flex items-center justify-between font-inter text-xs text-black/50">
          <span>Cellular Synergy Breakdown</span>
          <span>90+ Nutrients • 46 Antioxidants • 18 Amino Acids</span>
        </div>
      </div>
    </section>
  );
}
