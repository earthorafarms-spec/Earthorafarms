import { motion, type Variants } from "framer-motion";
import { Link } from "wouter";
import {
  Sun,
  Shield,
  Brain,
  Leaf,
  Sparkles,
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Zap,
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import leavesImg from "@assets/generated_images/hero_leaves.jpg";
import leavesImg2 from "@assets/generated_images/hero_leaves_2.jpg";

const keyBenefits = [
  {
    num: "01",
    icon: Sun,
    title: "Sustained Energy & Vitality",
    tagline: "Natural ATP Synthesis",
    desc: "Unlike caffeine or sugar stimulants that cause adrenal fatigue and abrupt crashes, Moringa provides steady cellular energy by delivering bioavailable iron, magnesium, and essential B-complex vitamins directly to your mitochondria.",
    stat: "8 Hours",
    statLabel: "Sustained Focus",
    highlights: ["Supports cellular respiration", "No jitters or adrenal spikes", "Rich in natural Iron & Magnesium"],
    accentBg: "bg-[#ECEDEC]",
  },
  {
    num: "02",
    icon: Shield,
    title: "Immune System Fortification",
    tagline: "7x More Vitamin C than Oranges",
    desc: "Moringa leaves are loaded with quercetin, chlorogenic acid, and high concentrations of Vitamin C and Zinc. This potent antioxidant shield neutralizes free radicals, reduces oxidative stress, and strengthens daily immunity.",
    stat: "46+",
    statLabel: "Active Antioxidants",
    highlights: ["Neutralizes free radicals", "High quercetin concentration", "Natural daily defense shield"],
    accentBg: "bg-[#FEFDF9]",
  },
  {
    num: "03",
    icon: Brain,
    title: "Cognitive Endurance & Clarity",
    tagline: "Neuro-Protective Compounds",
    desc: "The unique combination of Vitamin E, Vitamin C, Zinc, and iron in moringa supports healthy neurotransmitter activity and cerebral blood flow, promoting sharp mental clarity, memory retention, and stress resilience.",
    stat: "18",
    statLabel: "Amino Acids Included",
    highlights: ["Supports focus & memory", "Nourishes neural pathways", "Reduces brain fog naturally"],
    accentBg: "bg-[#FEFDF9]",
  },
  {
    num: "04",
    icon: Sparkles,
    title: "Cellular Glow & Skin Health",
    tagline: "4x More Vitamin A than Carrots",
    desc: "Nourishes your skin from within. High levels of Vitamin A and E promote natural collagen synthesis, fight premature cellular aging, and give skin a healthy, vibrant radiance.",
    stat: "100% Raw",
    statLabel: "Cold-Processed",
    highlights: ["Promotes collagen synthesis", "Combats cellular aging", "Nourishes skin from within"],
    accentBg: "bg-[#ECEDEC]",
  },
];

const comparisonData = [
  { metric: "Vitamin C", moringa: "7x", benchmark: "vs. Fresh Oranges", icon: Zap },
  { metric: "Vitamin A", moringa: "4x", benchmark: "vs. Organic Carrots", icon: Leaf },
  { metric: "Calcium", moringa: "4x", benchmark: "vs. Whole Milk", icon: Activity },
  { metric: "Iron", moringa: "3x", benchmark: "vs. Raw Spinach", icon: Sun },
  { metric: "Potassium", moringa: "3x", benchmark: "vs. Ripe Bananas", icon: Shield },
  { metric: "Protein", moringa: "2g / tsp", benchmark: "All 9 Essential Aminos", icon: Brain },
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
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
      <Navbar />

      {/* ── Hero / Page Header ── */}
      <section className="relative pt-36 pb-20 lg:pt-44 lg:pb-28 overflow-hidden bg-[#0E0E0E] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06)_0,transparent_70%)] pointer-events-none" />
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 font-dm font-medium text-xs sm:text-sm text-white/80 tracking-[0.05em] uppercase backdrop-blur-md"
          >
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>Botanical Science</span>
          </motion.div>

          <div className="grid lg:grid-cols-12 gap-8 items-end">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="lg:col-span-8"
            >
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[44px] leading-[46px] sm:text-[68px] sm:leading-[64px] lg:text-[88px] lg:leading-[82px] text-white">
                Nature's most complete <br />
                <span className="text-white/35">nutritional matrix.</span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="lg:col-span-4 font-inter font-normal text-base sm:text-lg text-white/55 leading-relaxed tracking-[-0.02em]"
            >
              Backed by ancient tradition and modern botanical science. 90+ bioavailable nutrients working in complete cellular synergy.
            </motion.p>
          </div>
        </div>
      </section>

      {/* ── Key Benefits Architectural Layout (Editorial Style) ── */}
      <section className="py-20 lg:py-32">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="mb-16 lg:mb-24 flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-black/10">
            <div>
              <span className="font-inter text-xs uppercase tracking-wider text-black/40 font-medium block mb-2">
                Scientific Breakdown
              </span>
              <h2 className="font-dm font-normal text-3xl sm:text-5xl text-black tracking-[-0.04em]">
                Targeted Cellular Health
              </h2>
            </div>
            <p className="font-inter text-sm text-black/60 max-w-sm">
              Discover how cold-processed moringa delivers raw nutrients directly to your body's systems.
            </p>
          </div>

          {/* Alternating Feature Cards */}
          <div className="space-y-12 lg:space-y-16">
            {keyBenefits.map((benefit, i) => (
              <motion.div
                key={benefit.num}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className={`rounded-3xl border border-black/8 p-8 sm:p-12 lg:p-14 ${benefit.accentBg} shadow-sm hover:shadow-xl transition-all duration-500`}
              >
                <div className="grid lg:grid-cols-12 gap-8 items-start">
                  {/* Left: Number & Header */}
                  <div className="lg:col-span-5 flex flex-col justify-between h-full">
                    <div>
                      <div className="flex items-center gap-4 mb-6">
                        <span className="font-dm text-4xl lg:text-5xl font-normal text-black/20 tracking-[-0.05em]">
                          {benefit.num}
                        </span>
                        <span className="px-3.5 py-1 rounded-full bg-black/5 text-black font-inter text-xs font-medium tracking-wide uppercase">
                          {benefit.tagline}
                        </span>
                      </div>

                      <h3 className="font-dm font-normal text-3xl sm:text-4xl lg:text-5xl text-black tracking-[-0.04em] leading-tight mb-4">
                        {benefit.title}
                      </h3>
                    </div>

                    <div className="pt-6 border-t border-black/10 mt-6 lg:mt-12">
                      <span className="font-dm text-3xl sm:text-4xl text-black tracking-[-0.04em] block">
                        {benefit.stat}
                      </span>
                      <span className="font-inter text-xs uppercase tracking-wider text-black/50 font-medium">
                        {benefit.statLabel}
                      </span>
                    </div>
                  </div>

                  {/* Right: Detailed Narrative & Checklist */}
                  <div className="lg:col-span-7 lg:pl-8 lg:border-l lg:border-black/10">
                    <p className="font-inter text-base sm:text-lg text-black/75 leading-relaxed tracking-[-0.02em] mb-8">
                      {benefit.desc}
                    </p>

                    <div className="space-y-3 font-inter text-sm text-black/80">
                      {benefit.highlights.map((h, idx) => (
                        <div key={idx} className="flex items-center gap-3">
                          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                          <span>{h}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Nutritional Comparison Grid ── */}
      <section className="py-20 lg:py-32 bg-[#0E0E0E] text-white relative overflow-hidden">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10">
          <div className="max-w-3xl mb-16 lg:mb-20">
            <span className="font-inter text-xs uppercase tracking-wider text-white/40 font-medium block mb-2">
              Density Comparison
            </span>
            <h2 className="font-dm font-normal text-4xl sm:text-6xl text-white tracking-[-0.05em] leading-tight mb-4">
              Gram for gram, <br />
              <span className="text-white/40">unmatched on earth.</span>
            </h2>
            <p className="font-inter text-base text-white/60">
              Comparing raw moringa leaf powder with traditional whole food nutritional benchmarks.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {comparisonData.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.08 }}
                className="bg-[#181818] border border-white/10 rounded-2xl p-8 flex flex-col justify-between hover:border-white/25 transition-all"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className="font-inter text-xs font-medium uppercase tracking-wider text-white/50">
                      {item.metric}
                    </span>
                    <item.icon className="w-5 h-5 text-amber-300" />
                  </div>
                  <span className="font-dm font-normal text-5xl text-white tracking-[-0.05em] block mb-2">
                    {item.moringa}
                  </span>
                </div>
                <div className="pt-4 border-t border-white/10 text-xs font-inter text-white/50">
                  {item.benchmark}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature Story & Bottom CTA ── */}
      <section className="py-24 lg:py-36 bg-[#FAF9F5] text-black">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="bg-[#ECEDEC] rounded-3xl p-8 sm:p-14 border border-black/8 grid lg:grid-cols-12 gap-8 items-center shadow-lg">
            <div className="lg:col-span-8">
              <h2 className="font-dm font-normal text-3xl sm:text-5xl text-black tracking-[-0.04em] leading-tight mb-4">
                Ready to experience pure vitality?
              </h2>
              <p className="font-inter text-base text-black/70 max-w-xl leading-relaxed">
                Start your daily moringa ritual today with our 100% organic, shade-dried powders and capsules sourced directly from our farm.
              </p>
            </div>
            <div className="lg:col-span-4 flex lg:justify-end">
              <Link
                href="/products"
                className="bg-black text-white px-8 py-4 rounded-xl font-inter font-medium text-base hover:bg-black/85 transition-all shadow-xl inline-flex items-center gap-2 group"
              >
                <span>Shop The Collection</span>
                <ArrowUpRight className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
