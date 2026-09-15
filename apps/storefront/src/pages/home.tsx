import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/sections/Hero";
import { HomeMarquee } from "@/components/sections/HomeMarquee";
import { HomeProducts } from "@/components/sections/HomeProducts";
import { HomeBenefits } from "@/components/sections/HomeBenefits";
import { HomeTestimonials } from "@/components/sections/HomeTestimonials";
import { HomeFAQ } from "@/components/sections/HomeFAQ";

export default function Home() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-primary/20">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <HomeMarquee />
        <HomeProducts />
        <HomeBenefits />
        <HomeTestimonials />
        <HomeFAQ />
      </main>
      <Footer />
    </div>
  );
}
