import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, useScroll, useMotionValueEvent, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { ShoppingBag, Menu, X, Heart, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/cart-context";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { UserDashboardModal } from "@/components/user/UserDashboardModal";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "Our Product", href: "/our-product" },
  { label: "Health Benefits", href: "/health-benefits" },
  { label: "Gallery", href: "/gallery" },
  { label: "Recipes", href: "/recipes" },
  { label: "Contact", href: "/contact" },
];

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [favoritesCount, setFavoritesCount] = useState(0);
  const { cartCount } = useCart();
  const { user, signOut } = useAuth();
  const { scrollY } = useScroll();

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Fetch initial favorites count
  useEffect(() => {
    const email = user?.email;
    if (!email) {
      setFavoritesCount(0);
      return;
    }
    (supabase.from("favorite_details") as any)
      .select("id", { count: "exact", head: true })
      .eq("user_email", email)
      .then(({ count }: { count: number | null }) => setFavoritesCount(count || 0));
  }, [user]);

  // Listen for optimistic wishlist changes from product cards
  useEffect(() => {
    const handler = (e: Event) => {
      setFavoritesCount((prev) => Math.max(0, prev + (e as CustomEvent<number>).detail));
    };
    window.addEventListener("wishlist-changed" as any, handler);
    return () => window.removeEventListener("wishlist-changed" as any, handler);
  }, []);

  useMotionValueEvent(scrollY, "change", (latest) => {
    setIsScrolled(latest > 50);
  });

  const handleMobileNavClick = () => {
    setIsMobileOpen(false);
  };

  const textClr = isScrolled ? "text-foreground" : "text-primary-foreground";

  return (
    <>
      <motion.header
        className={`fixed top-0 w-full z-50 transition-colors duration-500 border-b ${textClr} ${
          isScrolled ? "bg-background/90 backdrop-blur-md border-border/50 shadow-sm" : "bg-transparent border-transparent"
        }`}
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <Link href="/">
            <span className={`font-serif text-2xl font-semibold tracking-tight cursor-pointer ${isScrolled ? "text-primary" : "text-primary-foreground"}`}>
              Earthora
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link key={link.label} href={link.href}>
                <span className="text-sm font-medium transition-colors hover:opacity-70 cursor-pointer">
                  {link.label}
                </span>
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            {user && (
              <>
                <Link href="/favorites" className="relative p-2 transition-opacity hover:opacity-70">
                  <Heart className="w-5 h-5" />
                  {favoritesCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 flex items-center justify-center bg-accent text-[10px] font-bold text-white rounded-full animate-pulse">
                      {favoritesCount}
                    </span>
                  )}
                </Link>
                <button
                  onClick={() => setIsDashboardOpen(true)}
                  className="p-2 transition-opacity hover:opacity-70"
                  title="My Account Settings"
                >
                  <Settings className="w-5 h-5" />
                </button>
              </>
            )}
            <Link href="/cart" className="relative p-2 transition-opacity hover:opacity-70">
              <ShoppingBag className="w-5 h-5" />
              {cartCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 flex items-center justify-center bg-accent text-[10px] font-bold text-white rounded-full">
                  {cartCount}
                </span>
              )}
            </Link>
            {user ? (
              <Button
                variant={isScrolled ? "default" : "secondary"}
                className="hidden md:inline-flex bg-white text-primary hover:bg-white/90 border border-border/20 font-medium"
                onClick={() => signOut()}
              >
                Log Out
              </Button>
            ) : (
              <Link href="/auth">
                <Button variant={isScrolled ? "default" : "secondary"} className="hidden md:inline-flex bg-white text-primary hover:bg-white/90">
                  Log In
                </Button>
              </Link>
            )}
            <button
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              className="md:hidden p-2"
            >
              {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </motion.header>

      {mounted && createPortal(
        <AnimatePresence>
          {isMobileOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-black/50 z-[100] md:hidden"
                onClick={() => setIsMobileOpen(false)}
              />
              <motion.nav
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="fixed top-0 right-0 bottom-0 w-72 z-[101] bg-background border-l border-border/50 shadow-xl md:hidden flex flex-col"
              >
                <div className="flex items-center justify-between h-20 px-6 border-b border-border/20">
                  <span className="font-serif text-xl text-foreground">Earthora</span>
                  <button onClick={() => setIsMobileOpen(false)} className="p-2 text-foreground">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 flex flex-col px-4 pt-6 gap-1">
                  {navLinks.map((item) => (
                    <Link key={item.label} href={item.href} onClick={() => handleMobileNavClick()}>
                      <span className="block px-4 py-3 text-sm font-medium text-foreground rounded-lg hover:bg-muted transition-colors cursor-pointer">
                        {item.label}
                      </span>
                    </Link>
                  ))}
                </div>
                <div className="px-4 pb-8">
                  <Link href="/auth" onClick={() => setIsMobileOpen(false)}>
                    <Button className="w-full h-11 text-sm bg-primary text-white">Log In</Button>
                  </Link>
                </div>
              </motion.nav>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}

      <UserDashboardModal isOpen={isDashboardOpen} onClose={() => setIsDashboardOpen(false)} />
    </>
  );
}
