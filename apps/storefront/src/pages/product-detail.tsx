import { useState, useMemo, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Star,
  ShoppingBag,
  Zap,
  CheckCircle2,
  Heart,
  Truck,
  ShieldCheck,
  Leaf,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Minus,
  Plus,
  Check,
  AlertCircle,
  ArrowLeft
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useCart } from "@/contexts/cart-context";
import { useCheckout } from "@/hooks/useCheckout";
import { useToast } from "@/hooks/use-toast";
import { fetchReviews } from "@/lib/api";
import { publicProductsQuery } from "@/lib/catalogQuery";
import type { Product } from "@/types";
import powderImg from "@assets/generated_images/product_powder.jpg";

const WISHLIST_KEY = "earthora-wishlist";

export default function ProductDetail() {
  const [, params] = useRoute("/product/:id");
  const [, setLocation] = useLocation();
  const productId = params?.id;

  const { data: products = [], isLoading } = useQuery<Product[]>({
    ...publicProductsQuery,
  });

  const { data: dbReviews = [] } = useQuery<any[]>({
    queryKey: ["product-reviews"],
    queryFn: fetchReviews,
    staleTime: 1000 * 60 * 5,
  });

  const product = useMemo(() => {
    if (!productId || products.length === 0) return null;
    return products.find((p) => p.id === productId || (p as any).slug === productId) || null;
  }, [products, productId]);

  const [selectedImage, setSelectedImage] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [isWishlisted, setIsWishlisted] = useState<boolean>(false);
  const [justAdded, setJustAdded] = useState<boolean>(false);
  const [buyingNow, setBuyingNow] = useState<boolean>(false);
  const [openFaq, setOpenFaq] = useState<Record<string, boolean>>({
    benefits: true,
    dosage: false,
    purity: false,
  });

  const toggleFaq = (key: string) => {
    setOpenFaq((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const { addToCart } = useCart();
  const { runCheckout, isPaying } = useCheckout();
  const { toast } = useToast();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [productId]);

  useEffect(() => {
    if (product) {
      setSelectedImage(product.imageMain || powderImg);
      setQuantity(1);
    }
  }, [product]);

  useEffect(() => {
    if (!productId) return;
    try {
      const raw = localStorage.getItem(WISHLIST_KEY);
      if (raw) {
        const list = JSON.parse(raw);
        setIsWishlisted(Array.isArray(list) && list.includes(productId));
      }
    } catch {
      setIsWishlisted(false);
    }
  }, [productId]);

  const toggleWishlist = () => {
    if (!product) return;
    try {
      const raw = localStorage.getItem(WISHLIST_KEY);
      let list: string[] = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) list = [];
      let nextState = false;
      if (list.includes(product.id)) {
        list = list.filter((id) => id !== product.id);
        nextState = false;
        toast({ title: "Removed from favorites" });
      } else {
        list.push(product.id);
        nextState = true;
        toast({ title: "Saved to favorites", description: `${product.name} has been added to your favorites.` });
      }
      localStorage.setItem(WISHLIST_KEY, JSON.stringify(list));
      setIsWishlisted(nextState);
      window.dispatchEvent(new CustomEvent("wishlist-changed", { detail: nextState ? 1 : -1 }));
    } catch {
      // ignore
    }
  };

  const handleAddToCart = () => {
    if (!product) return;
    for (let i = 0; i < quantity; i++) {
      addToCart({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.imageMain,
      });
    }
    setJustAdded(true);
    toast({
      title: "Added to cart",
      description: `${quantity} × ${product.name} added to your cart.`,
    });
    setTimeout(() => setJustAdded(false), 2000);
  };

  const handleBuyNow = async () => {
    if (!product || buyingNow || isPaying) return;
    setBuyingNow(true);
    const result = await runCheckout([
      {
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.imageMain,
        quantity,
      },
    ]);
    setBuyingNow(false);
    if (result) setLocation("/cart");
  };

  const productReviews = useMemo(() => {
    if (!product) return [];
    return dbReviews.filter((r: any) => r.review_product_id === product.id);
  }, [dbReviews, product]);

  const relatedProducts = useMemo(() => {
    if (!product) return [];
    return products.filter((p) => p.id !== product.id).slice(0, 3);
  }, [products, product]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-[#FAF9F5] text-black">
        <Navbar />
        <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-32 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-emerald-800/30 border-t-emerald-800 rounded-full animate-spin" />
            <p className="text-sm font-inter text-black/60">Harvesting product details…</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex flex-col bg-[#FAF9F5] text-black">
        <Navbar />
        <main data-voice-page-error className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-36 text-center">
          <AlertCircle className="w-12 h-12 text-black/40 mx-auto mb-4" />
          <h1 className="font-dm text-3xl font-normal text-black mb-3">Product Not Found</h1>
          <p className="font-inter text-sm text-black/60 mb-8 max-w-md mx-auto">
            The botanical item you're looking for may have been retired or does not exist.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-black text-white font-inter text-sm font-medium hover:bg-black/85 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Home</span>
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  const savings = product.mrp > product.price ? product.mrp - product.price : 0;
  const savingsPct = product.mrp > 0 ? Math.round((savings / product.mrp) * 100) : 0;
  const allImages = product.allImages?.length > 0 ? product.allImages : [product.imageMain];

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F5] text-black selection:bg-emerald-900 selection:text-white">
      <Navbar />

      <main className="flex-1 pt-24 pb-20 lg:pt-28 lg:pb-32">
        <div className="container mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-xs font-inter text-black/50 mb-8 pt-4">
            <Link href="/" className="hover:text-black transition-colors">Home</Link>
            <ChevronRight className="w-3.5 h-3.5 text-black/30" />
            <Link href="/#products" className="hover:text-black transition-colors">Products</Link>
            <ChevronRight className="w-3.5 h-3.5 text-black/30" />
            <span className="text-black font-medium truncate max-w-[200px] sm:max-w-xs">{product.name}</span>
          </nav>

          {/* Product Overview Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">
            {/* Left: Gallery Column */}
            <div className="lg:col-span-6 flex flex-col gap-4">
              <div className="relative aspect-square w-full rounded-3xl overflow-hidden bg-[#F3F1EA] border border-black/8 shadow-sm">
                {product.badge && (
                  <span className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-full bg-[#0E1F13] text-white text-[10px] font-inter font-semibold tracking-[0.2em] uppercase shadow-sm">
                    {product.badge}
                  </span>
                )}

                {savingsPct > 0 && (
                  <span className="absolute top-4 right-4 z-10 px-3 py-1.5 rounded-full bg-white text-[#0E1F13] border border-black/10 text-xs font-inter font-bold tracking-wide shadow-sm">
                    Save {savingsPct}%
                  </span>
                )}

                <img
                  src={selectedImage || product.imageMain}
                  alt={product.name}
                  className="w-full h-full object-cover transition-all duration-500"
                />
              </div>

              {/* Thumbnails */}
              {allImages.length > 1 && (
                <div className="flex items-center gap-3 overflow-x-auto pb-2 pt-1">
                  {allImages.map((img, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedImage(img)}
                      className={`relative w-20 h-20 rounded-2xl overflow-hidden bg-[#F3F1EA] border-2 transition-all shrink-0 ${
                        selectedImage === img
                          ? "border-[#0E1F13] shadow-md scale-102"
                          : "border-black/10 opacity-70 hover:opacity-100"
                      }`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {/* Trust Badges */}
              <div className="grid grid-cols-3 gap-3 pt-4 border-t border-black/8">
                <div className="p-3.5 rounded-2xl bg-white/70 border border-black/5 text-center flex flex-col items-center gap-1.5">
                  <Leaf className="w-5 h-5 text-emerald-800" />
                  <span className="text-[11px] font-inter font-medium text-black/80">100% Organic</span>
                  <span className="text-[10px] font-inter text-black/45">Pure single origin</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-white/70 border border-black/5 text-center flex flex-col items-center gap-1.5">
                  <ShieldCheck className="w-5 h-5 text-emerald-800" />
                  <span className="text-[11px] font-inter font-medium text-black/80">Lab Certified</span>
                  <span className="text-[10px] font-inter text-black/45">Heavy-metal tested</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-white/70 border border-black/5 text-center flex flex-col items-center gap-1.5">
                  <Truck className="w-5 h-5 text-emerald-800" />
                  <span className="text-[11px] font-inter font-medium text-black/80">Fast Shipping</span>
                  <span className="text-[10px] font-inter text-black/45">Dispatched in 24h</span>
                </div>
              </div>
            </div>

            {/* Right: Buy Box & Product Info */}
            <div className="lg:col-span-6 flex flex-col">
              {/* Tag */}
              {product.tag && (
                <span className="inline-block font-inter text-xs font-semibold tracking-[0.2em] uppercase text-emerald-900 mb-2">
                  {product.tag}
                </span>
              )}

              {/* Title */}
              <h1 className="font-dm text-3xl sm:text-4xl lg:text-5xl font-normal tracking-[-0.03em] text-black leading-[1.1] mb-4">
                {product.name}
              </h1>

              {/* Rating row */}
              <div className="flex items-center gap-3 mb-6">
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-4 h-4 ${
                        i < Math.floor(product.rating || 5)
                          ? "fill-amber-500 text-amber-500"
                          : "fill-amber-500/20 text-amber-500/30"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-sm font-inter font-semibold text-black">
                  {product.rating ? Number(product.rating).toFixed(1) : "4.9"}
                </span>
                <span className="text-xs font-inter text-black/40">
                  ({product.reviewCount || productReviews.length || 28} verified reviews)
                </span>
              </div>

              {/* Price Row */}
              <div className="p-5 rounded-2xl bg-white/80 border border-black/8 mb-6 flex flex-col gap-2">
                <div className="flex items-baseline gap-3">
                  <span className="font-dm text-3xl sm:text-4xl font-normal text-[#0E1F13] tracking-tight">
                    ₹{product.price.toFixed(0)}
                  </span>
                  {product.mrp > product.price && (
                    <span className="font-inter text-base sm:text-lg line-through text-black/40">
                      ₹{product.mrp.toFixed(0)}
                    </span>
                  )}
                  {savings > 0 && (
                    <span className="text-xs font-inter font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-full">
                      Save ₹{Math.round(savings)} ({savingsPct}%)
                    </span>
                  )}
                </div>
                <p className="text-[11px] font-inter text-black/50">
                  Inclusive of all taxes. Free express shipping on orders over ₹499.
                </p>
              </div>

              {/* Description preview */}
              {product.description && (
                <p className="font-inter text-sm sm:text-base text-black/70 leading-relaxed mb-6">
                  {product.description}
                </p>
              )}

              {/* Highlights pills */}
              {product.highlights && product.highlights.length > 0 && (
                <div className="mb-8">
                  <h4 className="font-inter text-xs font-semibold tracking-wider uppercase text-black/50 mb-3">
                    Key Highlights
                  </h4>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {product.highlights.map((h, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-xs font-inter text-black/80">
                        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Quantity & CTA Actions */}
              <div className="flex flex-col gap-3.5 mb-8">
                <div className="flex items-center gap-3">
                  {/* Quantity selector */}
                  <div className="inline-flex items-center rounded-xl border border-black/15 bg-white p-1 h-13">
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      disabled={quantity <= 1}
                      className="w-10 h-full flex items-center justify-center text-black/60 hover:text-black disabled:opacity-30"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-10 text-center font-inter font-semibold text-sm text-black">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.min(10, q + 1))}
                      disabled={quantity >= 10}
                      className="w-10 h-full flex items-center justify-center text-black/60 hover:text-black disabled:opacity-30"
                      aria-label="Increase quantity"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Add to Cart button */}
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    className={`flex-1 h-13 px-6 rounded-xl font-inter font-medium text-sm sm:text-base flex items-center justify-center gap-2.5 transition-all shadow-sm ${
                      justAdded
                        ? "bg-[#2E5B32] text-white"
                        : "bg-white text-[#0E1F13] border border-black/20 hover:bg-black/5"
                    }`}
                  >
                    {justAdded ? (
                      <>
                        <Check className="w-5 h-5" />
                        <span>Added to Cart!</span>
                      </>
                    ) : (
                      <>
                        <ShoppingBag className="w-5 h-5" />
                        <span>Add to Cart</span>
                      </>
                    )}
                  </button>

                  {/* Wishlist button */}
                  <button
                    type="button"
                    onClick={toggleWishlist}
                    aria-label="Save to favorites"
                    className={`w-13 h-13 rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
                      isWishlisted
                        ? "bg-rose-50 border-rose-200 text-rose-600"
                        : "bg-white border-black/15 text-black/60 hover:text-black hover:bg-black/5"
                    }`}
                  >
                    <Heart className={`w-5 h-5 ${isWishlisted ? "fill-rose-600" : ""}`} />
                  </button>
                </div>

                {/* Primary Buy Now button */}
                <button
                  type="button"
                  onClick={handleBuyNow}
                  disabled={buyingNow || isPaying}
                  className="w-full h-14 rounded-xl bg-[#0E1F13] text-white font-inter font-semibold text-base tracking-wide flex items-center justify-center gap-2.5 hover:bg-[#0E1F13]/90 transition-all shadow-lg hover:shadow-xl disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {buyingNow ? (
                    <span>Opening Checkout…</span>
                  ) : (
                    <>
                      <Zap className="w-5 h-5 text-amber-400 fill-amber-400" />
                      <span>Buy Now with Instant Checkout</span>
                    </>
                  )}
                </button>
              </div>

              {/* Botanical Details FAQ Dropdown Accordion */}
              <div className="border-t border-black/10 pt-6 mt-2 flex flex-col gap-3">
                <span className="text-[11px] font-inter font-semibold tracking-[0.2em] uppercase text-black/45 block mb-1">
                  PRODUCT SPECIFICATIONS & GUIDE
                </span>

                {/* FAQ 1: Botanical Benefits */}
                <div className="rounded-2xl border border-black/10 bg-white/70 overflow-hidden transition-all duration-200 hover:border-black/20">
                  <button
                    type="button"
                    onClick={() => toggleFaq("benefits")}
                    className="w-full flex items-center justify-between p-4 text-left font-dm text-base font-medium text-black group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                        <Leaf className="w-4 h-4 text-emerald-700" />
                      </div>
                      <span className="group-hover:text-emerald-900 transition-colors font-dm text-base">
                        Botanical Benefits
                      </span>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-black/50 transition-transform duration-300 ${
                        openFaq.benefits ? "rotate-180 text-black" : ""
                      }`}
                    />
                  </button>

                  <AnimatePresence initial={false}>
                    {openFaq.benefits && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-5 pt-1 text-sm font-inter text-black/75 leading-relaxed space-y-2 border-t border-black/5">
                          <p>• <strong>Full-Spectrum Bio-Nutrients:</strong> Delivers 90+ vital micronutrients, 46 active antioxidants, and all 9 essential amino acids for deep cellular replenishment.</p>
                          <p>• <strong>Sustained Vitality:</strong> Generates clean, lasting physical stamina without the nervous caffeine spikes or afternoon crashes.</p>
                          <p>• <strong>Immune & Metabolic Support:</strong> Naturally promotes healthy glucose response, gut balance, and systemic recovery.</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* FAQ 2: Recommended Usage */}
                <div className="rounded-2xl border border-black/10 bg-white/70 overflow-hidden transition-all duration-200 hover:border-black/20">
                  <button
                    type="button"
                    onClick={() => toggleFaq("dosage")}
                    className="w-full flex items-center justify-between p-4 text-left font-dm text-base font-medium text-black group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                        <Sparkles className="w-4 h-4 text-emerald-700" />
                      </div>
                      <span className="group-hover:text-emerald-900 transition-colors font-dm text-base">
                        Recommended Usage
                      </span>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-black/50 transition-transform duration-300 ${
                        openFaq.dosage ? "rotate-180 text-black" : ""
                      }`}
                    />
                  </button>

                  <AnimatePresence initial={false}>
                    {openFaq.dosage && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-5 pt-1 text-sm font-inter text-black/75 leading-relaxed space-y-2 border-t border-black/5">
                          <p>• <strong>Tablets:</strong> Take 2 tablets twice daily with warm water or herbal tea, ideally after morning and evening meals.</p>
                          <p>• <strong>Powder:</strong> Blend 1 level teaspoon (~3g) into morning green smoothies, warm broths, or fresh citrus water.</p>
                          <p>• <strong>Ritual Consistency:</strong> For peak bio-availability, maintain daily intake for at least 21 days.</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* FAQ 3: Origin & Purity */}
                <div className="rounded-2xl border border-black/10 bg-white/70 overflow-hidden transition-all duration-200 hover:border-black/20">
                  <button
                    type="button"
                    onClick={() => toggleFaq("purity")}
                    className="w-full flex items-center justify-between p-4 text-left font-dm text-base font-medium text-black group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                        <ShieldCheck className="w-4 h-4 text-emerald-700" />
                      </div>
                      <span className="group-hover:text-emerald-900 transition-colors font-dm text-base">
                        Origin & Purity
                      </span>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-black/50 transition-transform duration-300 ${
                        openFaq.purity ? "rotate-180 text-black" : ""
                      }`}
                    />
                  </button>

                  <AnimatePresence initial={false}>
                    {openFaq.purity && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-5 pt-1 text-sm font-inter text-black/75 leading-relaxed space-y-2 border-t border-black/5">
                          <p>• <strong>Single Origin:</strong> 100% grown, nurtured, and harvested on chemical-free organic soils in Gujarat, India.</p>
                          <p>• <strong>Solar Shade Drying:</strong> Leaves are picked at dawn and gently dehydrated below 40°C in climate-controlled dark rooms, locking in delicate chlorophyll and active enzymes.</p>
                          <p>• <strong>Purity Guarantee:</strong> Zero added preservatives, zero synthetic binders, GMO-free, and independently batch-tested for heavy metals.</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>

          {/* View Similar Products Section */}
          <div className="mt-20 lg:mt-32 pt-14 border-t border-black/8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
              <div>
                <span className="text-[10px] font-inter font-semibold tracking-[0.2em] uppercase text-black/45 block mb-1">
                  CURATED BOTANICALS
                </span>
                <h2 className="font-dm text-2xl sm:text-3xl lg:text-4xl font-normal text-black tracking-tight">
                  View Similar Products
                </h2>
                <p className="font-inter text-xs sm:text-sm text-black/60 mt-1 max-w-xl">
                  Pure, single-origin botanical superfoods harvested directly from our certified organic farm.
                </p>
              </div>

              <Link
                href="/#products"
                className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-inter font-medium text-black hover:text-emerald-800 transition-colors self-start md:self-end"
              >
                <span>Browse entire harvest</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            {/* If other live products exist in DB, display them */}
            {relatedProducts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {relatedProducts.map((p) => (
                  <Link
                    key={p.id}
                    href={`/product/${p.id}`}
                    className="group bg-white rounded-3xl border border-black/8 overflow-hidden p-5 flex flex-col transition-all duration-300 hover:shadow-xl hover:-translate-y-1"
                  >
                    <div className="relative aspect-square rounded-2xl overflow-hidden bg-[#F3F1EA] mb-4">
                      {p.badge && (
                        <span className="absolute top-3 left-3 z-10 px-2.5 py-1 rounded-full bg-[#0E1F13] text-white text-[9px] font-inter font-semibold tracking-[0.2em] uppercase">
                          {p.badge}
                        </span>
                      )}
                      <img
                        src={p.imageMain}
                        alt={p.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </div>
                    <h3 className="font-dm text-base font-medium text-black group-hover:text-emerald-800 transition-colors line-clamp-1 mb-2">
                      {p.name}
                    </h3>
                    <div className="flex items-baseline gap-2 mt-auto">
                      <span className="font-dm text-lg font-normal text-[#0E1F13]">₹{p.price.toFixed(0)}</span>
                      {p.mrp > p.price && (
                        <span className="font-inter text-xs line-through text-black/40">₹{p.mrp.toFixed(0)}</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              /* When only 1 product in DB, display upcoming companion harvests */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-white/80 rounded-3xl border border-black/8 overflow-hidden p-5 flex flex-col transition-all duration-300 hover:shadow-lg">
                  <div className="relative aspect-square rounded-2xl overflow-hidden bg-[#F3F1EA] mb-4">
                    <span className="absolute top-3 left-3 z-10 px-2.5 py-1 rounded-full bg-[#0E1F13] text-white text-[9px] font-inter font-semibold tracking-[0.2em] uppercase">
                      Coming Soon
                    </span>
                    <img
                      src={powderImg}
                      alt="Organic Moringa Leaf Powder"
                      className="w-full h-full object-cover opacity-90"
                    />
                  </div>
                  <h3 className="font-dm text-base font-medium text-black line-clamp-1 mb-1">
                    Organic Moringa Leaf Powder (100g)
                  </h3>
                  <p className="text-xs font-inter text-black/50 mb-3 line-clamp-2">
                    100% shade-dried organic moringa leaves milled to fine bio-active vitality powder.
                  </p>
                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-black/5">
                    <span className="font-dm text-base font-normal text-[#0E1F13]">₹349</span>
                    <span className="text-[10px] font-inter font-medium text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full">
                      Next Farm Harvest
                    </span>
                  </div>
                </div>

                <div className="bg-white/80 rounded-3xl border border-black/8 overflow-hidden p-5 flex flex-col transition-all duration-300 hover:shadow-lg">
                  <div className="relative aspect-square rounded-2xl overflow-hidden bg-[#F3F1EA] mb-4">
                    <span className="absolute top-3 left-3 z-10 px-2.5 py-1 rounded-full bg-[#0E1F13] text-white text-[9px] font-inter font-semibold tracking-[0.2em] uppercase">
                      In Preparation
                    </span>
                    <img
                      src={product.imageMain}
                      alt="Wild Amla Vitamin C Tablets"
                      className="w-full h-full object-cover opacity-90"
                    />
                  </div>
                  <h3 className="font-dm text-base font-medium text-black line-clamp-1 mb-1">
                    Wild Amla Vitamin C Tablets (60 Tabs)
                  </h3>
                  <p className="text-xs font-inter text-black/50 mb-3 line-clamp-2">
                    Sun-ripened forest amla berries rich in natural bio-available antioxidant Vitamin C.
                  </p>
                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-black/5">
                    <span className="font-dm text-base font-normal text-[#0E1F13]">₹449</span>
                    <span className="text-[10px] font-inter font-medium text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full">
                      Formulation Ready
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Sticky Mobile Buy Bar */}
      <div data-voice-bottom-bar className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-black/10 px-4 py-3 shadow-2xl flex items-center justify-between gap-3">
        <div>
          <span className="font-dm text-lg font-semibold text-[#0E1F13]">₹{product.price.toFixed(0)}</span>
          <span className="block text-[10px] font-inter text-black/50">Free Express Delivery</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAddToCart}
            className="px-4 py-3 rounded-xl border border-black/15 bg-white text-xs font-inter font-medium text-black"
          >
            {justAdded ? "Added!" : "Add to Cart"}
          </button>
          <button
            type="button"
            onClick={handleBuyNow}
            disabled={buyingNow || isPaying}
            className="px-5 py-3 rounded-xl bg-[#0E1F13] text-white text-xs font-inter font-semibold tracking-wide shadow-md"
          >
            Buy Now
          </button>
        </div>
      </div>

      <Footer />
    </div>
  );
}
