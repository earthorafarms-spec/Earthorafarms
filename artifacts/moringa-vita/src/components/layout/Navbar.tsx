import { useState, type MouseEvent } from "react";
import { motion, useScroll, useMotionValueEvent } from "framer-motion";
import { ShoppingBag, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (latest) => {
    setIsScrolled(latest > 50);
  });

  const handleNavClick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    const navbarOffset = 80;
    const top = target.getBoundingClientRect().top + window.scrollY - navbarOffset;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <motion.header
      className={`fixed top-0 w-full z-50 transition-colors duration-500 border-b ${
        isScrolled ? "bg-background/90 backdrop-blur-md border-border/50 shadow-sm" : "bg-transparent border-transparent"
      }`}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="container mx-auto px-6 h-20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`font-serif text-2xl font-semibold tracking-tight ${isScrolled ? "text-primary" : "text-primary-foreground"}`}>
            Moringa Vita
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-8">
          {["Origins", "Formats", "Benefits", "Ritual"].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase()}`}
              onClick={(e) => handleNavClick(e, item.toLowerCase())}
              className={`text-sm font-medium transition-colors hover:opacity-70 ${
                isScrolled ? "text-foreground" : "text-primary-foreground"
              }`}
            >
              {item}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <button className={`p-2 transition-opacity hover:opacity-70 ${isScrolled ? "text-foreground" : "text-primary-foreground"}`}>
            <ShoppingBag className="w-5 h-5" />
          </button>
          <Button variant={isScrolled ? "default" : "secondary"} className="hidden md:inline-flex bg-white text-primary hover:bg-white/90">
            Shop Collection
          </Button>
          <button className={`md:hidden p-2 ${isScrolled ? "text-foreground" : "text-primary-foreground"}`}>
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </div>
    </motion.header>
  );
}
