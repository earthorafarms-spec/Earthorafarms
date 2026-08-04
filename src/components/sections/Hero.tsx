import { ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import terraHeroBg from "@assets/generated_images/terra_hero_bg.webp";
import terraBottle from "@assets/generated_images/hero_bottle_new.png";

const BG_IMAGE_URL = terraHeroBg;
const PRODUCT_BOTTLE_URL = terraBottle;

export function Hero() {
  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden bg-cover bg-center bg-no-repeat selection:bg-white selection:text-black pt-24 sm:pt-28 lg:pt-32"
      style={{ backgroundImage: `url("${BG_IMAGE_URL}")` }}
    >
      {/* ── Hero Content Section ── */}
      <section className="flex-1 flex flex-col justify-center px-5 sm:px-8 lg:px-10 pt-4 sm:pt-8 pb-8 sm:pb-12 z-10">
        <div className="max-w-[1400px]">
          {/* Animated Headline */}
          <h1 className="font-dm font-normal tracking-[-0.05em] text-[36px] leading-[40px] xs:text-[42px] xs:leading-[44px] sm:text-[70px] sm:leading-[68px] md:text-[95px] md:leading-[88px] lg:text-[120px] lg:leading-[105px] xl:text-[145px] xl:leading-[120px]">
            {/* Line 1 */}
            <div className="flex flex-wrap items-baseline gap-x-[0.2em] py-1">
              <span className="overflow-hidden inline-block animate-word-reveal delay-300 py-1">
                <span className="inline-block text-white pr-1">The</span>
              </span>
              <span className="overflow-hidden inline-block animate-word-reveal delay-400 py-1">
                <span className="inline-block text-white pr-1">Power</span>
              </span>
              <span className="overflow-hidden inline-block animate-word-reveal delay-500 py-1">
                <span className="inline-block text-white/50 pr-1">of</span>
              </span>
            </div>

            {/* Line 2 */}
            <div className="flex flex-wrap items-baseline gap-x-[0.2em] py-1">
              <span className="overflow-hidden inline-block animate-word-reveal delay-600 py-1">
                <span className="inline-block text-white/50 pr-1">Nature</span>
              </span>
              <span className="overflow-hidden inline-block animate-word-reveal delay-700 py-1">
                <span className="inline-block text-white/50 pr-1">in</span>
              </span>
              <span className="overflow-hidden inline-block animate-word-reveal delay-800 py-1">
                <span className="inline-block text-white pr-1">Every</span>
              </span>
            </div>

            {/* Line 3 */}
            <div className="flex items-center gap-x-[0.2em] flex-wrap py-1">
              <span className="overflow-hidden inline-block animate-word-reveal delay-900 py-1">
                <span className="inline-block text-white pr-1">Leaf</span>
              </span>
            </div>
          </h1>

          {/* CTA Section */}
          <div className="mt-6 sm:mt-10 lg:mt-[60px] flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8 lg:gap-[50px] animate-fade-up delay-600">
            <Link
              href="/our-product"
              className="bg-black text-white rounded-md w-full sm:w-[240px] md:w-[280px] lg:w-[310px] h-12 sm:h-16 lg:h-[72px] font-inter font-medium text-sm sm:text-lg lg:text-2xl tracking-[-0.03em] flex items-center justify-center gap-2 hover:bg-black/90 transition-all duration-300 shadow-xl group shrink-0"
            >
              <span>Explore Now</span>
              <ArrowUpRight
                size={20}
                className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
              />
            </Link>
            <p className="text-white/90 max-w-[310px] font-inter font-normal text-xs sm:text-base lg:text-lg leading-[1.45] tracking-[-0.02em]">
              Discover our new plant-based supplements for daily balance and
              clean energy.
            </p>
          </div>
        </div>
      </section>

      {/* ── Mobile/Tablet Oversized Bleeding Product Image (visible below lg) ── */}
      <div className="block lg:hidden relative z-0 animate-scale-in delay-800 mt-4 sm:mt-8 px-4 flex justify-end">
        <img
          src={PRODUCT_BOTTLE_URL}
          alt="TerraElix Supplement Bottle"
          className="w-[85%] max-w-[340px] sm:max-w-[480px] object-contain drop-shadow-2xl translate-x-4"
        />
      </div>

      {/* ── Desktop Floating Product Image (lg+ absolute) ── */}
      <img
        src={PRODUCT_BOTTLE_URL}
        alt="TerraElix Supplement Bottle Floating"
        className="hidden lg:block absolute z-0 animate-scale-in delay-700 pointer-events-none drop-shadow-2xl"
        style={{
          width: "clamp(500px, 60vw, 1100px)",
          height: "auto",
          bottom: "-22%",
          right: "clamp(-200px, -10vw, 0px)",
        }}
      />
    </div>
  );
}
