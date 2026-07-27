import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/sections/Hero";
import { Origin } from "@/components/sections/Origin";
import { Products } from "@/components/sections/Products";
import { Benefits } from "@/components/sections/Benefits";
import { Ritual } from "@/components/sections/Ritual";


export default function Home() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/20">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <Origin />
        <Products />
        <Benefits />
        <Ritual />

      </main>
      <Footer />
    </div>
  );
}
