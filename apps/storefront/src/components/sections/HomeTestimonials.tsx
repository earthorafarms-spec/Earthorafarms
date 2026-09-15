import { motion } from "framer-motion";
import { Star, CheckCircle2 } from "lucide-react";

interface Testimonial {
  quote: string;
  author: string;
  location: string;
  duration: string;
  span?: "narrow" | "wide";
  accent: "green" | "gold" | "cream" | "sage" | "deep";
}

const IMPACT_STATS = [
  { value: "94%",    label: "reported steadier energy",    sub: "after 30 days" },
  { value: "8/10",   label: "reduced their afternoon coffee", sub: "at week 3" },
  { value: "1,240+", label: "verified 5-star reviews",     sub: "and counting" },
  { value: "76%",    label: "repurchase within 60 days",   sub: "our proudest number" },
];

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "It's the only supplement I've actually stayed consistent with. Three months in, my energy is genuinely steady and my skin looks like I've been sleeping ten hours.",
    author: "Priya S.",
    location: "Bengaluru",
    duration: "3 months in",
    span: "wide",
    accent: "green",
  },
  {
    quote:
      "My afternoon dip is gone. That's the only thing I've changed in my routine.",
    author: "Aisha K.",
    location: "Delhi",
    duration: "6 weeks in",
    accent: "cream",
  },
  {
    quote:
      "Digestion is easier. Sleep is deeper. I didn't expect a green powder to touch either of those.",
    author: "Sneha D.",
    location: "Chennai",
    duration: "8 weeks in",
    accent: "gold",
  },
  {
    quote:
      "Skin, hair, nails — the boring vanity stuff — actually shifted. Six weeks was my turning point.",
    author: "Aditi R.",
    location: "Kolkata",
    duration: "6 weeks in",
    accent: "sage",
  },
  {
    quote:
      "My trainer put me onto this after protein powders were wrecking my stomach. No bloat, real recovery.",
    author: "Kabir T.",
    location: "Gurgaon",
    duration: "4 months in",
    accent: "cream",
  },
  {
    quote:
      "I keep it on the kitchen counter, not in a cabinet. That's the highest praise I can give a supplement.",
    author: "Ishani N.",
    location: "Bengaluru",
    duration: "5 months in",
    span: "wide",
    accent: "deep",
  },
];

// Palette drawn strictly from the site's existing tokens: cream backgrounds,
// forest greens (#0E1F13 / #2E5B32), warm gold (#E6C670), sage (#D6E5B8).
const ACCENTS = {
  green: {
    bg: "bg-[#2E5B32]",
    fg: "text-white",
    muted: "text-white/60",
    tag: "bg-white/10 text-white",
    border: "border-white/15",
  },
  deep: {
    bg: "bg-[#0E1F13]",
    fg: "text-white",
    muted: "text-white/55",
    tag: "bg-white/10 text-white",
    border: "border-white/15",
  },
  gold: {
    bg: "bg-[#E6C670]",
    fg: "text-[#2B1F0E]",
    muted: "text-[#2B1F0E]/60",
    tag: "bg-[#2B1F0E]/10 text-[#2B1F0E]",
    border: "border-[#2B1F0E]/15",
  },
  sage: {
    bg: "bg-[#D6E5B8]",
    fg: "text-[#1E3320]",
    muted: "text-[#1E3320]/60",
    tag: "bg-[#1E3320]/10 text-[#1E3320]",
    border: "border-[#1E3320]/15",
  },
  cream: {
    bg: "bg-[#FEFDF9]",
    fg: "text-black",
    muted: "text-black/55",
    tag: "bg-black/6 text-black/75",
    border: "border-black/10",
  },
} as const;

export function HomeTestimonials() {
  return (
    <section className="bg-[#FAF9F5] py-24 lg:py-32 relative overflow-hidden">
      <div className="container mx-auto max-w-[1400px] px-6 sm:px-10">
        {/* Section header */}
        <div className="flex flex-col items-center text-center mb-14 lg:mb-20">
          <span className="inline-block px-4 py-1.5 rounded-full border border-black/15 bg-white text-[10px] font-inter font-semibold tracking-[0.25em] uppercase text-black/60 mb-6">
            REVIEWS
          </span>
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="font-dm font-normal text-[42px] leading-[1.02] sm:text-[56px] sm:leading-[1.02] lg:text-[68px] lg:leading-[0.98] tracking-[-0.04em] text-black max-w-[900px]"
          >
            The proof <em className="not-italic text-black/45">is in the ritual.</em>
          </motion.h2>
          <p className="mt-5 font-inter text-sm sm:text-base text-black/55 max-w-[560px]">
            Every review is from a verified purchase — no incentives, no filters, no paid seats.
          </p>
        </div>

        {/* Impact stats — 4 tall columns with divider lines */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="grid grid-cols-2 lg:grid-cols-4 rounded-3xl bg-[#FEFDF9] border border-black/8 overflow-hidden mb-14 lg:mb-16 divide-x divide-y lg:divide-y-0 divide-black/8"
        >
          {IMPACT_STATS.map((s) => (
            <div key={s.label} className="p-6 lg:p-8 text-center lg:text-left">
              <div className="font-dm font-normal text-[48px] leading-none lg:text-[64px] tracking-[-0.04em] text-[#0E1F13]">
                {s.value}
              </div>
              <p className="mt-3 font-inter text-sm text-black/70 leading-snug">{s.label}</p>
              <p className="mt-1 font-inter text-[11px] uppercase tracking-[0.15em] text-black/40">
                {s.sub}
              </p>
            </div>
          ))}
        </motion.div>

        {/* Masonry-ish wall of testimonials */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5 auto-rows-[minmax(220px,auto)]">
          {TESTIMONIALS.map((t, i) => (
            <TestimonialCard key={`${t.author}-${i}`} testimonial={t} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TestimonialCard({ testimonial, index }: { testimonial: Testimonial; index: number }) {
  const a = ACCENTS[testimonial.accent];
  const span = testimonial.span === "wide" ? "lg:col-span-2" : "";

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-3xl p-6 lg:p-7 flex flex-col justify-between ${a.bg} ${a.fg} ${a.border} ${
        testimonial.accent === "cream" ? "border" : ""
      } ${span}`}
    >
      <div>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Star key={i} className="w-3.5 h-3.5 fill-current opacity-90" />
            ))}
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-inter font-semibold tracking-[0.12em] uppercase ${a.tag}`}
          >
            <CheckCircle2 className="w-2.5 h-2.5" />
            Verified
          </span>
        </div>

        <p
          className={`font-dm leading-snug tracking-[-0.01em] ${
            testimonial.span === "wide" ? "text-xl lg:text-2xl" : "text-lg lg:text-xl"
          }`}
        >
          &ldquo;{testimonial.quote}&rdquo;
        </p>
      </div>

      <footer className={`mt-6 pt-5 border-t ${a.border} flex items-center gap-3`}>
        <span
          className={`inline-flex items-center justify-center w-9 h-9 rounded-full shrink-0 font-dm text-sm ${a.tag}`}
        >
          {testimonial.author.charAt(0)}
        </span>
        <div className="min-w-0">
          <p className="font-inter text-[13px] font-semibold leading-tight truncate">
            {testimonial.author}
          </p>
          <p className={`font-inter text-[11px] tracking-wide truncate ${a.muted}`}>
            {testimonial.location} · {testimonial.duration}
          </p>
        </div>
      </footer>
    </motion.article>
  );
}
