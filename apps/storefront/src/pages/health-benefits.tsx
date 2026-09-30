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
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import leavesImg from "@assets/generated_images/hero_leaves.jpg";
import leavesImg2 from "@assets/generated_images/hero_leaves_2.jpg";

const keyBenefits = [
  {
    num: "01",
    icon: Sun,
    title: "Everyday Energy",
    tagline: "Product Description",
    desc: "The current Morilife+ description lists energy among the areas its moringa leaf tablets are intended to support.",
    stat: "120",
    statLabel: "Tablets per Bottle",
    highlights: ["Moringa leaf tablet format", "Check the current product details", "Follow the directions on the label"],
    accentBg: "bg-[#ECEDEC]",
  },
  {
    num: "02",
    icon: Shield,
    title: "Immunity & Digestion",
    tagline: "Product Description",
    desc: "The product description says Morilife+ tablets are rich in antioxidants, vitamins and minerals and are intended to support immunity and digestion.",
    stat: "Leaf",
    statLabel: "Moringa Format",
    highlights: ["Antioxidants listed in the description", "Vitamins and minerals listed", "Check ingredients on the product label"],
    accentBg: "bg-[#FEFDF9]",
  },
  {
    num: "03",
    icon: Brain,
    title: "Skin & Hair",
    tagline: "Product Description",
    desc: "Skin and hair are among the areas of intended support listed in the current Morilife+ product description.",
    stat: "Care",
    statLabel: "Daily Wellness",
    highlights: ["Moringa leaf tablets", "Review the live product listing", "Ask the team for batch-specific details"],
    accentBg: "bg-[#FEFDF9]",
  },
  {
    num: "04",
    icon: Sparkles,
    title: "How to Take Morilife+",
    tagline: "Approved Label",
    desc: "The approved label says to take 1–2 tablets once or twice daily, before breakfast or dinner. Follow the directions on your pack and seek individual advice when needed.",
    stat: "1–2",
    statLabel: "Tablets per Dose",
    highlights: ["Once or twice daily", "Before breakfast or dinner", "Follow the product label"],
    accentBg: "bg-[#ECEDEC]",
  },
];

const productFacts = [
  { metric: "Product", value: "Morilife+", detail: "Moringa Leaf Tablets", icon: Leaf },
  { metric: "Bottle", value: "120", detail: "tablets per bottle", icon: Activity },
  { metric: "Suggested Use", value: "1–2", detail: "tablets once or twice daily", icon: Sun },
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
                Explore Morilife+ <br />
                <span className="text-white/35">moringa leaf tablets.</span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="lg:col-span-4 font-inter font-normal text-base sm:text-lg text-white/55 leading-relaxed tracking-[-0.02em]"
            >
              See what the current product description and approved label say about intended support and suggested use.
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
                Product Description
              </span>
              <h2 className="font-dm font-normal text-3xl sm:text-5xl text-black tracking-[-0.04em]">
                Everyday Wellness
              </h2>
            </div>
            <p className="font-inter text-sm text-black/60 max-w-sm">
              Explore the areas of intended support listed for Morilife+ and check the label before use.
            </p>
          </div>

          {/* Alternating Feature Cards */}
          <div className="space-y-12 lg:space-y-16">
            {keyBenefits.map((benefit, i) => (
              <motion.div
                key={benefit.num}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.05 }}
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

      {/* ── Current Product Facts ── */}
      <section className="py-20 lg:py-32 bg-[#0E0E0E] text-white relative overflow-hidden">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10">
          <div className="max-w-3xl mb-16 lg:mb-20">
            <span className="font-inter text-xs uppercase tracking-wider text-white/40 font-medium block mb-2">
              Current Product Facts
            </span>
            <h2 className="font-dm font-normal text-4xl sm:text-6xl text-white tracking-[-0.05em] leading-tight mb-4">
              Know what you're <br />
              <span className="text-white/40">choosing today.</span>
            </h2>
            <p className="font-inter text-base text-white/60">
              These details come from the current Morilife+ product listing and approved directions. Check the pack for the latest label.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {productFacts.map((item, i) => (
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
                    {item.value}
                  </span>
                </div>
                <div className="pt-4 border-t border-white/10 text-xs font-inter text-white/50">
                  {item.detail}
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
                Ready to explore the current product?
              </h2>
              <p className="font-inter text-base text-black/70 max-w-xl leading-relaxed">
                Explore our current moringa products and check the product label for ingredients and directions before you order.
              </p>
            </div>
            <div className="lg:col-span-4 flex lg:justify-end">
              <Link
                href="/#products"
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
