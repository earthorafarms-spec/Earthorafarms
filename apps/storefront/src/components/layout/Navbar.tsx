import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, useScroll, useMotionValueEvent, AnimatePresence } from "framer-motion";
import { Link, useLocation } from "wouter";
import { ShoppingBag, Menu, X, Heart, ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useCart } from "@/contexts/cart-context";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { fetchPublicProducts } from "@/lib/api";
import type { Product } from "@/types";
import earthoraTextSvg from "@assets/generated_images/Earthora Text.svg";

const WISHLIST_KEY = "earthora-wishlist";

function readWishlistCount(): number {
  try {
    const raw = localStorage.getItem(WISHLIST_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function cleanProductName(name: string): string {
  if (!name) return "";
  return name.replace(/\s*\(.*?\)/g, "").trim();
}

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [productsDropdownOpen, setProductsDropdownOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [favoritesCount, setFavoritesCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { cartCount } = useCart();
  const { scrollY } = useScroll();
  const [location, setLocation] = useLocation();

  const isHomePage = location === "/";

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["public-products"],
    queryFn: fetchPublicProducts,
    staleTime: 1000 * 60 * 5,
  });

  useEscapeKey(() => {
    setIsMobileOpen(false);
    setProductsDropdownOpen(false);
  }, isMobileOpen || productsDropdownOpen);

  useEffect(() => {
    setMounted(true);
    setFavoritesCount(readWishlistCount());
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (isMobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileOpen]);

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

  const handleProductClick = (productId: string) => {
    setIsMobileOpen(false);
    setProductsDropdownOpen(false);
    setLocation(`/product/${productId}`);
  };

  const headerBg = isScrolled
    ? "bg-[#FEFDF9]/90 backdrop-blur-md border-black/8 shadow-sm"
    : isHomePage
    ? "bg-transparent border-transparent"
    : "bg-[#FAF9F5]/90 backdrop-blur-md border-black/8";

  const textColor = isHomePage && !isScrolled ? "text-white" : "text-black";
  const mutedTextColor = isHomePage && !isScrolled ? "text-white/80 hover:text-white" : "text-black/70 hover:text-black";

  return (
    <>
      <motion.header
        className={`fixed top-0 w-full z-50 transition-all duration-300 border-b ${headerBg} ${textColor}`}
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center cursor-pointer py-1">
            <img
              src={earthoraTextSvg}
              alt="Earthora"
              className={`h-4.5 sm:h-5 w-auto object-contain transition-all duration-300 ${
                isHomePage && !isScrolled ? "brightness-0 invert" : ""
              }`}
            />
          </Link>

          <nav className="hidden md:flex items-center gap-7 lg:gap-8 font-dm font-medium text-sm">
            <Link href="/">
              <span className={`transition-colors cursor-pointer ${location === "/" ? "opacity-100 font-semibold underline underline-offset-4" : mutedTextColor}`}>
                Home
              </span>
            </Link>

            {/* Dynamic Products: direct links if <= 3, elegant dropdown if > 3 */}
            {products.length <= 3 ? (
              products.map((p) => {
                const isActive = location === `/product/${p.id}` || location === `/product/${(p as any).slug}`;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProductClick(p.id)}
                    className={`transition-colors cursor-pointer text-sm font-dm font-medium text-left ${
                      isActive ? "opacity-100 font-semibold underline underline-offset-4" : mutedTextColor
                    }`}
                  >
                    {cleanProductName(p.name)}
                  </button>
                );
              })
            ) : (
              <div
                ref={dropdownRef}
                className="relative"
                onMouseEnter={() => setProductsDropdownOpen(true)}
                onMouseLeave={() => setProductsDropdownOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (location === "/") {
                      document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
                    } else {
                      setLocation("/#products");
                    }
                  }}
                  className={`flex items-center gap-1.5 transition-colors cursor-pointer text-sm font-dm font-medium ${mutedTextColor}`}
                >
                  <span>Products</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${productsDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                <AnimatePresence>
                  {productsDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.98 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className="absolute top-full left-0 mt-2 w-72 bg-white/95 backdrop-blur-md rounded-2xl p-2 shadow-2xl border border-black/10 z-50 text-black flex flex-col gap-1"
                    >
                      {products.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleProductClick(p.id)}
                          className="flex items-center gap-3 p-2 rounded-xl hover:bg-black/5 transition-colors text-left w-full group/item"
                        >
                          <img
                            src={p.imageMain}
                            alt={p.name}
                            className="w-10 h-10 rounded-lg object-cover bg-[#F3F1EA] shrink-0 border border-black/5"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-dm font-medium text-black truncate group-hover/item:text-emerald-800 transition-colors">
                              {cleanProductName(p.name)}
                            </p>
                            <p className="text-[11px] font-inter text-black/50 font-normal">
                              ₹{p.price.toFixed(0)}
                            </p>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <Link href="/health-benefits">
              <span className={`transition-colors cursor-pointer ${location === "/health-benefits" ? "opacity-100 font-semibold underline underline-offset-4" : mutedTextColor}`}>
                Health Benefits
              </span>
            </Link>

            <Link href="/contact">
              <span className={`transition-colors cursor-pointer ${location === "/contact" ? "opacity-100 font-semibold underline underline-offset-4" : mutedTextColor}`}>
                Contact
              </span>
            </Link>
          </nav>

          <div className="flex items-center gap-3 sm:gap-4 font-inter">
            <Link href="/favorites" className={`relative p-2 transition-opacity ${mutedTextColor}`}>
              <Heart className="w-5 h-5" />
              {favoritesCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 flex items-center justify-center bg-rose-500 text-[10px] font-bold text-white rounded-full">
                  {favoritesCount}
                </span>
              )}
            </Link>

            <Link href="/cart" className={`relative p-2 transition-opacity ${mutedTextColor}`}>
              <ShoppingBag className="w-5 h-5" />
              {cartCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 flex items-center justify-center bg-emerald-700 text-[10px] font-bold text-white rounded-full">
                  {cartCount}
                </span>
              )}
            </Link>

            <button
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              className="md:hidden p-2"
              aria-label="Open menu"
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
                className="fixed top-0 right-0 bottom-0 w-80 z-[101] bg-[#FAF9F5] text-black border-l border-black/10 shadow-2xl md:hidden flex flex-col"
              >
                <div className="flex items-center justify-between h-20 px-6 border-b border-black/10">
                  <img src={earthoraTextSvg} alt="Earthora" className="h-4.5 w-auto object-contain" />
                  <button onClick={() => setIsMobileOpen(false)} className="p-2 text-black/60 hover:text-black" aria-label="Close menu">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 flex flex-col px-4 pt-4 overflow-y-auto gap-1">
                  <Link href="/" onClick={() => setIsMobileOpen(false)}>
                    <span className={`block px-4 py-3 font-dm text-base font-normal rounded-xl transition-colors cursor-pointer ${location === "/" ? "bg-black/10 text-black font-medium" : "text-black/70 hover:bg-black/5"}`}>
                      Home
                    </span>
                  </Link>

                  {/* Mobile Products List */}
                  {products.length > 0 && (
                    <div className="py-2">
                      <span className="px-4 text-[10px] font-inter font-semibold tracking-[0.2em] uppercase text-black/40 block mb-1.5">
                        Products
                      </span>
                      <div className="flex flex-col gap-1">
                        {products.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handleProductClick(p.id)}
                            className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-left hover:bg-black/5 transition-colors w-full"
                          >
                            <img
                              src={p.imageMain}
                              alt={p.name}
                              className="w-8 h-8 rounded-lg object-cover bg-[#F3F1EA] shrink-0 border border-black/5"
                            />
                            <div className="flex-1 min-w-0">
                              <span className="block font-dm text-sm font-medium text-black truncate">
                                {cleanProductName(p.name)}
                              </span>
                              <span className="block font-inter text-[11px] text-black/50">
                                ₹{p.price.toFixed(0)}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <Link href="/health-benefits" onClick={() => setIsMobileOpen(false)}>
                    <span className={`block px-4 py-3 font-dm text-base font-normal rounded-xl transition-colors cursor-pointer ${location === "/health-benefits" ? "bg-black/10 text-black font-medium" : "text-black/70 hover:bg-black/5"}`}>
                      Health Benefits
                    </span>
                  </Link>

                  <Link href="/contact" onClick={() => setIsMobileOpen(false)}>
                    <span className={`block px-4 py-3 font-dm text-base font-normal rounded-xl transition-colors cursor-pointer ${location === "/contact" ? "bg-black/10 text-black font-medium" : "text-black/70 hover:bg-black/5"}`}>
                      Contact
                    </span>
                  </Link>
                </div>
              </motion.nav>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
