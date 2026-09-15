import { motion } from "framer-motion";
import leafImg from "@assets/generated_images/hero_leaves.jpg";
import productPowder from "@assets/generated_images/product_powder.jpg";

const PILL_LABEL = "BENEFITS";

/**
 * Bento grid of six benefits. Alternates solid-color text panels with imagery,
 * asymmetric heights, and each card leads with a big stat + label.
 */
export function HomeBenefits() {
  return (
    <section className="bg-[#FAF9F5] py-24 lg:py-32 relative overflow-hidden">
      <div className="container mx-auto max-w-[1400px] px-6 sm:px-10">
        {/* Section heading */}
        <div className="flex flex-col items-center text-center mb-14 lg:mb-20">
          <span className="inline-block px-4 py-1.5 rounded-full border border-black/15 bg-white text-[10px] font-inter font-semibold tracking-[0.25em] uppercase text-black/60 mb-6">
            {PILL_LABEL}
          </span>
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="font-dm font-normal text-[42px] leading-[1.02] sm:text-[56px] sm:leading-[1.02] lg:text-[68px] lg:leading-[0.98] tracking-[-0.04em] text-black max-w-[720px]"
          >
            Nature knows.
            <br />
            <em className="not-italic text-black/45">So does science.</em>
          </motion.h2>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 lg:gap-5 auto-rows-[minmax(220px,auto)]">
          {/* Row 1 */}
          <BenefitTextCard
            className="md:col-span-2 md:row-span-1 bg-[#2B4B2E] text-white"
            stat="8h+"
            statLabel="LASTING VITALITY"
            title="Sustained Energy"
            body="No crashes. No spikes. Just pure, steady cellular energy from morning through evening."
          />

          <BenefitTextCard
            className="md:col-span-2 md:row-span-1 bg-[#E6C670] text-[#2B1F0E]"
            stat="46×"
            statLabel="ANTIOXIDANTS"
            title="Immune Support"
            body="Densely packed with antioxidants, quercetin, and essential vitamins to fortify daily defenses."
          />

          <BenefitImageCard
            className="md:col-span-2 md:row-span-2"
            src={leafImg}
            alt="Fresh moringa leaves"
          />

          {/* Row 2 */}
          <BenefitImageCard
            className="md:col-span-2 md:row-span-1"
            src={productPowder}
            alt="Moringa powder"
          />

          <BenefitTextCard
            className="md:col-span-2 md:row-span-1 bg-[#FEFDF9] text-black border border-black/8"
            stat="18"
            statLabel="AMINO ACIDS"
            title="Cognitive Clarity"
            body="Plant-based iron and zinc nourish neural pathways for sharper focus, memory, and mental stamina."
          />

          {/* Row 3 */}
          <BenefitTextCard
            className="md:col-span-3 bg-[#FEFDF9] text-black border border-black/8"
            stat="90+"
            statLabel="NUTRIENTS"
            title="Cellular Radiance"
            body="Vitamins A and E promote healthy skin regeneration and glowing complexion from within."
          />

          <BenefitTextCard
            className="md:col-span-3 bg-[#0E0E0E] text-white"
            stat="0"
            statLabel="ADDITIVES"
            title="Pure Alkalinity"
            body="Raw green chlorophyll gently balances body pH levels and counteracts chronic dietary acidity — nothing synthetic, ever."
          />
        </div>
      </div>
    </section>
  );
}

function BenefitTextCard({
  className,
  stat,
  statLabel,
  title,
  body,
}: {
  className?: string;
  stat: string;
  statLabel: string;
  title: string;
  body: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-3xl p-7 lg:p-9 flex flex-col justify-between min-h-[220px] ${className}`}
    >
      <div className="flex items-baseline gap-3">
        <span className="font-dm font-normal text-5xl lg:text-6xl tracking-[-0.04em] leading-none">
          {stat}
        </span>
        <span className="font-inter font-semibold text-[9px] tracking-[0.2em] uppercase opacity-60">
          {statLabel}
        </span>
      </div>
      <div className="mt-6">
        <h3 className="font-dm font-normal text-2xl lg:text-3xl tracking-[-0.03em] mb-2">
          {title}
        </h3>
        <p className="font-inter text-sm leading-relaxed opacity-75 max-w-[38ch]">
          {body}
        </p>
      </div>
    </motion.div>
  );
}

function BenefitImageCard({
  className,
  src,
  alt,
}: {
  className?: string;
  src: string;
  alt: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-3xl overflow-hidden relative min-h-[220px] ${className}`}
    >
      <img src={src} alt={alt} className="absolute inset-0 w-full h-full object-cover" />
    </motion.div>
  );
}
