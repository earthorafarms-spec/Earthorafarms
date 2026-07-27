import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, useScroll, useMotionValueEvent, AnimatePresence } from "framer-motion";
import { Link, useLocation } from "wouter";
import { ShoppingBag, Menu, X, Heart, Settings } from "lucide-react";
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
  const [location] = useLocation();

  const isHomePage = location === "/";

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
    setIsScrolled(latest > 40);
  });

  const handleMobileNavClick = () => {
    setIsMobileOpen(false);
  };

  // Color logic based on page and scroll state
  const headerBg = isScrolled
    ? "bg-[#FEFDF9]/90 backdrop-blur-md border-black/8 shadow-sm"
    : isHomePage
    ? "bg-transparent border-transparent"
    : "bg-[#FAF9F5]/90 backdrop-blur-md border-black/8";

  const textColor = isHomePage && !isScrolled ? "text-white" : "text-black";
  const mutedTextColor = isHomePage && !isScrolled ? "text-white/80 hover:text-white" : "text-black/70 hover:text-black";
  const buttonBg = isHomePage && !isScrolled ? "bg-white text-black hover:bg-white/90" : "bg-black text-white hover:bg-black/85";

  return (
    <>
      <motion.header
        className={`fixed top-0 w-full z-50 transition-all duration-300 border-b ${headerBg} ${textColor}`}
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="container mx-auto px-6 sm:px-10 h-20 flex items-center justify-between">
          <Link href="/">
            <span className="font-dm font-medium text-2xl tracking-[-0.04em] cursor-pointer">
              Earthora
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-8 font-dm font-medium text-sm">
            {navLinks.map((link) => (
              <Link key={link.label} href={link.href}>
                <span className={`transition-colors cursor-pointer ${location === link.href ? "opacity-100 font-semibold underline underline-offset-4" : mutedTextColor}`}>
                  {link.label}
                </span>
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-4 font-inter">
            {user && (
              <>
                <Link href="/favorites" className={`relative p-2 transition-opacity ${mutedTextColor}`}>
                  <Heart className="w-5 h-5" />
                  {favoritesCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 flex items-center justify-center bg-rose-500 text-[10px] font-bold text-white rounded-full">
                      {favoritesCount}
                    </span>
                  )}
                </Link>
                <button
                  onClick={() => setIsDashboardOpen(true)}
                  className={`p-2 transition-opacity ${mutedTextColor}`}
                  title="My Account Settings"
                >
                  <Settings className="w-5 h-5" />
                </button>
              </>
            )}

            <Link href="/cart" className={`relative p-2 transition-opacity ${mutedTextColor}`}>
              <ShoppingBag className="w-5 h-5" />
              {cartCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 flex items-center justify-center bg-emerald-700 text-[10px] font-bold text-white rounded-full">
                  {cartCount}
                </span>
              )}
            </Link>

            {user ? (
              <button
                className={`hidden md:inline-flex px-5 py-2.5 rounded-xl font-inter font-medium text-xs tracking-[-0.01em] transition-all shadow-sm ${buttonBg}`}
                onClick={() => signOut()}
              >
                Log Out
              </button>
            ) : (
              <Link href="/auth">
                <button className={`hidden md:inline-flex px-5 py-2.5 rounded-xl font-inter font-medium text-xs tracking-[-0.01em] transition-all shadow-sm ${buttonBg}`}>
                  Log In
                </button>
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
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] md:hidden"
                onClick={() => setIsMobileOpen(false)}
              />
              <motion.nav
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="fixed top-0 right-0 bottom-0 w-72 z-[101] bg-[#FAF9F5] text-black border-l border-black/10 shadow-2xl md:hidden flex flex-col"
              >
                <div className="flex items-center justify-between h-20 px-6 border-b border-black/10">
                  <span className="font-dm font-medium text-xl">Earthora</span>
                  <button onClick={() => setIsMobileOpen(false)} className="p-2 text-black/60 hover:text-black">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 flex flex-col px-4 pt-6 gap-1">
                  {navLinks.map((item) => (
                    <Link key={item.label} href={item.href} onClick={() => handleMobileNavClick()}>
                      <span className={`block px-4 py-3 font-dm text-base font-normal rounded-xl transition-colors cursor-pointer ${location === item.href ? "bg-black/10 text-black font-medium" : "text-black/70 hover:bg-black/5"}`}>
                        {item.label}
                      </span>
                    </Link>
                  ))}
                </div>

                <div className="px-4 pb-8">
                  {user ? (
                    <button
                      onClick={() => { signOut(); setIsMobileOpen(false); }}
                      className="w-full py-3.5 text-sm font-inter font-medium bg-black text-white rounded-xl shadow-md"
                    >
                      Log Out
                    </button>
                  ) : (
                    <Link href="/auth" onClick={() => setIsMobileOpen(false)}>
                      <button className="w-full py-3.5 text-sm font-inter font-medium bg-black text-white rounded-xl shadow-md">
                        Log In
                      </button>
                    </Link>
                  )}
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
