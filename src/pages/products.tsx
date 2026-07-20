import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Star, ShoppingCart, Zap, Heart, X, ChevronDown, ThumbsUp, Eye } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/cart-context";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

const containerVars: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.12 } },
};
const itemVars: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

interface Product {
  id: string;
  name: string;
  mrp: number;
  price: number;
  discount: number;
  rating: number;
  reviewCount: number;
  tag: string;
  imageMain: string;
  imageHover: string;
  badge: string;
  stock: string;
  highlights: string[];
  description: string;
}

interface Review {
  name: string;
  rating: number;
  comment: string;
  date: string;
}

// ── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-card rounded-xl border border-border/60 overflow-hidden flex flex-col animate-pulse">
      <div className="aspect-square bg-muted" />
      <div className="p-5 flex flex-col gap-3">
        <div className="h-3 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/2" />
        <div className="h-6 bg-muted rounded w-1/3" />
        <div className="flex gap-2 mt-2">
          <div className="flex-1 h-10 bg-muted rounded-lg" />
          <div className="flex-1 h-10 bg-muted rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default function Products() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [wishlist, setWishlist] = useState<Set<string>>(new Set());
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [modalImage, setModalImage] = useState<string>("");
  const [sortOpen, setSortOpen] = useState(false);
  const [sortBy, setSortBy] = useState("Popularity");
  const [reviews, setReviews] = useState<Record<string, Review[]>>({});
  const [reviewName, setReviewName] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const { addToCart } = useCart();
  const { toast } = useToast();

  // ── Fetch products from Supabase ──────────────────────────────────────────
  const { data: rawProducts = [], isLoading } = useQuery<Product[]>({
    queryKey: ["public-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, inventory(*)")
        .neq("status", "archived")
        .order("created_at", { ascending: true });
      if (error) throw error;

      return (data as any[]).map((p) => {
        const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
        const images: { url: string; is_primary: boolean }[] = Array.isArray(p.images) ? p.images : [];
        const primaryImg = images.find((i) => i.is_primary)?.url || images[0]?.url || "";
        const secondaryImg = images.find((i) => !i.is_primary)?.url || primaryImg;
        const stockQty = inv?.total_stock ?? 0;
        const mrp = Number(p.mrp);
        const price = Number(p.price);
        return {
          id: p.id,
          name: p.name,
          mrp,
          price,
          discount: mrp > 0 ? Math.round(((mrp - price) / mrp) * 100) : 0,
          rating: Number(p.rating) || 4.5,
          reviewCount: Number(p.review_count) || 0,
          tag: p.tag || "",
          imageMain: primaryImg,
          imageHover: secondaryImg,
          badge: p.badge || "",
          stock: stockQty > 15 ? "In Stock" : stockQty > 0 ? "Low Stock" : "Out of Stock",
          highlights: Array.isArray(p.highlights) ? p.highlights : [],
          description: p.description || "",
        } as Product;
      });
    },
    staleTime: 1000 * 60 * 5, // 5 min cache
  });

  const sortOptions = ["Popularity", "Price: Low to High", "Price: High to Low", "Rating"];

  const sortedProducts = useMemo(() => {
    const list = [...rawProducts];
    switch (sortBy) {
      case "Price: Low to High": return list.sort((a, b) => a.price - b.price);
      case "Price: High to Low": return list.sort((a, b) => b.price - a.price);
      case "Rating": return list.sort((a, b) => b.rating - a.rating);
      default: return list;
    }
  }, [sortBy, rawProducts]);

  const handleAddToCart = (p: Product) => {
    addToCart({ id: p.id, name: p.name, price: p.price, image: p.imageMain });
    toast({ title: "Added to cart", description: `${p.name} has been added to your cart.` });
  };

  const handleBuyNow = (p: Product) => {
    addToCart({ id: p.id, name: p.name, price: p.price, image: p.imageMain });
    toast({ title: "Added to cart!", description: "Proceed to checkout." });
  };

  const handleSubmitReview = (productId: string) => {
    if (!reviewName.trim() || !reviewComment.trim()) return;
    const review: Review = {
      name: reviewName.trim(),
      rating: reviewRating,
      comment: reviewComment.trim(),
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    };
    setReviews((prev) => ({ ...prev, [productId]: [...(prev[productId] || []), review] }));
    setReviewName("");
    setReviewRating(5);
    setReviewComment("");
    toast({ title: "Review submitted", description: "Thank you for your feedback!" });
  };

  const toggleWishlist = (id: string) => {
    setWishlist((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/20">
      <Navbar />

      <section className="relative pt-40 pb-16 overflow-hidden bg-primary">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05)_0,transparent_70%)]" />
        <div className="container mx-auto px-6 max-w-7xl relative z-10">
          <div className="max-w-3xl">
            <motion.h1
              initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="text-4xl md:text-6xl font-serif text-primary-foreground leading-[1.1] tracking-tight mb-4"
            >
              The Earthora<br />
              <span className="text-secondary/90 italic">collection.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="text-lg text-primary-foreground/70 font-light max-w-2xl"
            >
              Pure moringa, direct from our family farm to your doorstep.
            </motion.p>
          </div>
        </div>
      </section>

      <section className="py-10 bg-background">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-8 pb-6 border-b border-border/50">
            <p className="text-sm text-foreground/50">
              <span className="text-foreground font-medium">{isLoading ? "…" : sortedProducts.length}</span> products
            </p>
            <div className="flex items-center gap-3 relative">
              <span className="text-xs text-foreground/40 uppercase tracking-wider">Sort by:</span>
              <button
                onClick={() => setSortOpen(!sortOpen)}
                className="flex items-center gap-2 text-sm bg-background border border-border/60 rounded-lg px-3 py-1.5 text-foreground hover:border-primary/40 transition-colors min-w-[140px]"
              >
                <span className="flex-1 text-left">{sortBy}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-foreground/40 transition-transform duration-300 ${sortOpen ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence>
                {sortOpen && (
                  <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.96 }}
                      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute top-full right-0 mt-1.5 w-48 z-20 bg-card border border-border/50 rounded-xl shadow-lg overflow-hidden"
                    >
                      {sortOptions.map((opt) => (
                        <button key={opt} onClick={() => { setSortBy(opt); setSortOpen(false); }}
                          className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors hover:bg-muted ${sortBy === opt ? "text-foreground font-medium" : "text-foreground/60"}`}
                        >
                          <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${sortBy === opt ? "border-primary" : "border-border"}`}>
                            {sortBy === opt && <span className="w-2 h-2 rounded-full bg-primary" />}
                          </span>
                          {opt}
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          <motion.div variants={containerVars} initial="hidden" animate={isLoading ? "hidden" : "show"}
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
              : sortedProducts.map((p) => (
                <motion.div
                  key={p.id} variants={itemVars}
                  onClick={() => { setSelectedProduct(p); setModalImage(p.imageMain); }}
                  onMouseEnter={() => setHoveredId(p.id)} onMouseLeave={() => setHoveredId(null)}
                  className="bg-card rounded-xl border border-border/60 overflow-hidden flex flex-col transition-shadow duration-300 hover:shadow-md cursor-pointer"
                >
                  <div className="relative aspect-square bg-white flex items-center justify-center p-6 border-b border-border/30">
                    {p.imageMain ? (
                      <img
                        src={hoveredId === p.id ? p.imageHover : p.imageMain}
                        alt={p.name}
                        className="w-full h-full object-contain transition-all duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted/40 rounded-lg">
                        <span className="text-4xl">🌿</span>
                      </div>
                    )}
                    {p.badge && (
                      <span className="absolute top-3 left-3 px-2.5 py-1 text-[11px] font-bold bg-primary text-primary-foreground rounded">
                        {p.badge}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleWishlist(p.id); }}
                      className="absolute top-3 right-3 p-2 bg-white rounded-full shadow-sm border border-border/40 hover:shadow-md transition-shadow"
                    >
                      <Heart className={`w-4 h-4 transition-colors ${wishlist.has(p.id) ? "fill-red-500 text-red-500" : "text-foreground/40"}`} strokeWidth={1.5} />
                    </button>
                  </div>

                  <div className="p-5 flex flex-col flex-1">
                    <div className="mb-2">
                      <h3 className="text-sm font-medium text-foreground leading-snug mb-1 line-clamp-2">{p.name}</h3>
                      <p className="text-xs text-foreground/40">{p.tag}</p>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-semibold text-foreground bg-accent/20 px-1.5 py-0.5 rounded">{p.rating}</span>
                        <div className="flex">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={`w-3 h-3 ${i < Math.round(p.rating) ? "fill-accent text-accent" : "text-border"}`} strokeWidth={1.5} />
                          ))}
                        </div>
                      </div>
                      {p.reviewCount > 0 && <span className="text-xs text-foreground/40">({p.reviewCount})</span>}
                    </div>
                    <div className="flex items-baseline gap-2 mb-3">
                      <span className="text-xl font-bold text-foreground">₹{p.price.toFixed(2)}</span>
                      {p.mrp > p.price && <span className="text-sm text-foreground/30 line-through">₹{p.mrp.toFixed(2)}</span>}
                      {p.discount > 0 && <span className="text-xs font-semibold text-accent">{p.discount}% off</span>}
                    </div>
                    <p className="text-[11px] text-green-700 font-semibold mb-3 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-600 inline-block" />
                      {p.stock}
                    </p>
                    <div className="flex gap-2 mt-auto">
                      <Button size="sm" className="flex-1 h-10 text-xs gap-1.5 bg-primary hover:bg-primary/90" onClick={(e) => { e.stopPropagation(); handleAddToCart(p); }}>
                        <ShoppingCart className="w-3.5 h-3.5" strokeWidth={1.5} /> Add to Cart
                      </Button>
                      <Button size="sm" variant="outline" className="h-10 text-xs gap-1 border-primary/40 text-primary hover:bg-primary/5" onClick={(e) => { e.stopPropagation(); handleBuyNow(p); }}>
                        <Zap className="w-3.5 h-3.5" strokeWidth={1.5} /> Buy Now
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))
            }
          </motion.div>

          {!isLoading && sortedProducts.length === 0 && (
            <div className="text-center py-20 text-foreground/40">
              <p className="text-sm">No products available yet. Check back soon.</p>
            </div>
          )}
        </div>
      </section>

      {/* Backdrop */}
      <AnimatePresence>
        {selectedProduct && (
          <motion.div key={`backdrop-${selectedProduct.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={() => setSelectedProduct(null)}
          />
        )}
      </AnimatePresence>

      {/* Product Modal */}
      <AnimatePresence>
        {selectedProduct && (
          <motion.div
            key={selectedProduct.id}
            initial={{ opacity: 0, y: "100%" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: "100%" }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 md:inset-x-8 md:inset-y-6 z-50 bg-background md:rounded-2xl overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-6 md:px-10 h-16 border-b border-border/30 shrink-0">
              <h2 className="text-sm font-serif text-foreground truncate">{selectedProduct.name}</h2>
              <button onClick={() => setSelectedProduct(null)} className="p-2 rounded-full hover:bg-muted transition-colors">
                <X className="w-5 h-5 text-foreground/60" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col lg:flex-row">
                {/* Images */}
                <div className="lg:w-[45%] bg-[#fafaf8] p-8 lg:p-12 flex flex-col items-center justify-start border-b lg:border-b-0 lg:border-r border-border/20">
                  <div className="w-full max-w-md aspect-square relative flex items-center justify-center">
                    <img src={modalImage || selectedProduct.imageMain} alt={selectedProduct.name} className="w-full h-full object-contain drop-shadow-sm" />
                  </div>
                  <div className="flex gap-3 mt-6">
                    {[selectedProduct.imageMain, selectedProduct.imageHover].filter(Boolean).map((src, i) => (
                      <button key={i} onClick={() => setModalImage(src)}
                        className={`w-16 h-16 rounded-xl border-2 overflow-hidden bg-white p-2 hover:border-primary/40 transition-colors ${modalImage === src ? "border-primary" : "border-border/40"}`}
                      >
                        <img src={src} alt="" className="w-full h-full object-contain" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Info */}
                <div className="lg:w-[55%] p-6 md:p-10">
                  <div className="max-w-xl">
                    {selectedProduct.badge && (
                      <span className="inline-block px-3 py-1 text-[11px] font-bold bg-primary text-primary-foreground rounded-md mb-5 tracking-wider uppercase">
                        {selectedProduct.badge}
                      </span>
                    )}
                    <h1 className="text-2xl md:text-3xl font-serif text-foreground leading-tight mb-2">{selectedProduct.name}</h1>
                    <p className="text-sm text-foreground/40 mb-5">{selectedProduct.tag}</p>

                    <div className="flex items-center gap-3 mb-6 pb-6 border-b border-border/20">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-foreground bg-accent/20 px-2 py-0.5 rounded-md">{selectedProduct.rating}</span>
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={`w-4 h-4 ${i < Math.round(selectedProduct.rating) ? "fill-accent text-accent" : "text-border"}`} strokeWidth={1.5} />
                          ))}
                        </div>
                      </div>
                      {selectedProduct.reviewCount > 0 && <span className="text-sm text-foreground/40">{selectedProduct.reviewCount} ratings</span>}
                      <span className="text-foreground/20">|</span>
                      <span className="text-sm text-green-700 font-medium">{selectedProduct.stock}</span>
                    </div>

                    <div className="flex items-baseline gap-3 mb-6">
                      <span className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">₹{selectedProduct.price.toFixed(2)}</span>
                      {selectedProduct.mrp > selectedProduct.price && <span className="text-lg text-foreground/30 line-through">₹{selectedProduct.mrp.toFixed(2)}</span>}
                      {selectedProduct.discount > 0 && <span className="text-sm font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-md">-{selectedProduct.discount}%</span>}
                    </div>

                    <div className="mb-6">
                      <h3 className="text-xs font-semibold text-foreground/50 uppercase tracking-widest mb-3">About this item</h3>
                      <p className="text-sm text-foreground/70 leading-relaxed mb-4">{selectedProduct.description}</p>
                      <ul className="space-y-2.5">
                        {selectedProduct.highlights.map((h) => (
                          <li key={h} className="text-sm text-foreground/60 flex items-start gap-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-2 shrink-0" />
                            {h}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="flex gap-3 pt-6 border-t border-border/20">
                      <Button className="flex-1 h-13 text-sm gap-2.5 bg-primary hover:bg-primary/90 rounded-xl" onClick={() => handleAddToCart(selectedProduct)}>
                        <ShoppingCart className="w-4 h-4" strokeWidth={1.5} /> Add to Cart
                      </Button>
                      <Button variant="outline" className="flex-1 h-13 text-sm gap-2.5 border-primary/30 text-primary hover:bg-primary/5 rounded-xl" onClick={() => handleBuyNow(selectedProduct)}>
                        <Zap className="w-4 h-4" strokeWidth={1.5} /> Buy Now
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reviews */}
              <div className="border-t border-border/20 px-6 md:px-12 py-10 bg-secondary/10">
                <div className="max-w-4xl mx-auto">
                  <h3 className="text-lg font-serif text-foreground mb-8">Customer Reviews</h3>
                  <div className="flex flex-col lg:flex-row gap-8">
                    {/* Write review */}
                    <div className="lg:w-80">
                      <h4 className="text-sm font-medium text-foreground mb-5 flex items-center gap-2">
                        <span className="w-5 h-px bg-primary/40" /> Write a Review
                      </h4>
                      <div className="bg-card rounded-2xl p-5 border border-border/30 space-y-4">
                        <input type="text" placeholder="Your name" value={reviewName} onChange={(e) => setReviewName(e.target.value)}
                          className="w-full h-11 px-4 text-sm bg-background border border-border/60 rounded-xl outline-none focus:border-primary/40 transition-colors" />
                        <div>
                          <span className="text-xs text-foreground/50 mb-2 block">Your Rating</span>
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((r) => (
                              <button key={r} type="button" onClick={() => setReviewRating(r)} className="p-0.5 hover:scale-110 transition-transform">
                                <Star className={`w-6 h-6 ${r <= reviewRating ? "fill-accent text-accent" : "text-border"}`} strokeWidth={1.5} />
                              </button>
                            ))}
                          </div>
                        </div>
                        <textarea placeholder="Share your thoughts..." value={reviewComment} onChange={(e) => setReviewComment(e.target.value)}
                          rows={3} className="w-full px-4 py-3 text-sm bg-background border border-border/60 rounded-xl outline-none focus:border-primary/40 transition-colors resize-none" />
                        <Button className="w-full h-11 text-sm" onClick={() => handleSubmitReview(selectedProduct.id)} disabled={!reviewName.trim() || !reviewComment.trim()}>
                          <ThumbsUp className="w-4 h-4 mr-1.5" strokeWidth={1.5} /> Submit Review
                        </Button>
                      </div>
                    </div>

                    {/* Review list */}
                    <div className="flex-1 space-y-4">
                      {(reviews[selectedProduct.id] || []).length === 0 ? (
                        <div className="text-center py-12">
                          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                            <Star className="w-6 h-6 text-border" strokeWidth={1} />
                          </div>
                          <p className="text-sm text-foreground/40 font-light">No reviews yet. Be the first to share your experience!</p>
                        </div>
                      ) : (
                        [...(reviews[selectedProduct.id] || [])].reverse().map((r, i) => (
                          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                            className="bg-card rounded-2xl p-5 border border-border/30"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary shrink-0">
                                  {r.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-foreground">{r.name}</span>
                                    <span className="px-2 py-0.5 text-[10px] font-medium text-green-700 bg-green-50 rounded-full">Verified Purchase</span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <div className="flex gap-0.5">
                                      {Array.from({ length: 5 }).map((_, si) => (
                                        <Star key={si} className={`w-3 h-3 ${si < r.rating ? "fill-accent text-accent" : "text-border"}`} strokeWidth={1.5} />
                                      ))}
                                    </div>
                                    <span className="text-xs text-foreground/30">{r.date}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <p className="text-sm text-foreground/60 font-light leading-relaxed">{r.comment}</p>
                          </motion.div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* You may also like */}
              {sortedProducts.filter((p) => p.id !== selectedProduct.id).length > 0 && (
                <div className="border-t border-border/20 px-6 md:px-12 py-10">
                  <div className="max-w-5xl mx-auto">
                    <h3 className="text-lg font-serif text-foreground mb-6">You may also like</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                      {sortedProducts.filter((p) => p.id !== selectedProduct.id).slice(0, 4).map((similar) => (
                        <button key={similar.id} onClick={() => { setSelectedProduct(similar); setModalImage(similar.imageMain); }}
                          className="group text-left bg-card rounded-2xl border border-border/30 overflow-hidden hover:border-primary/30 hover:shadow-sm transition-all"
                        >
                          <div className="aspect-square bg-white p-5 flex items-center justify-center relative">
                            <img src={similar.imageMain} alt={similar.name} className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105" />
                            {similar.badge && (
                              <span className="absolute top-2.5 left-2.5 px-2 py-0.5 text-[10px] font-bold bg-primary text-primary-foreground rounded-md">{similar.badge}</span>
                            )}
                          </div>
                          <div className="p-3.5">
                            <h4 className="text-xs font-medium text-foreground leading-snug mb-1.5 line-clamp-2">{similar.name}</h4>
                            <div className="flex items-center gap-1 mb-1.5">
                              <div className="flex gap-[1px]">
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Star key={i} className={`w-2.5 h-2.5 ${i < Math.round(similar.rating) ? "fill-accent text-accent" : "text-border"}`} strokeWidth={1.5} />
                                ))}
                              </div>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-sm font-bold text-foreground">₹{similar.price.toFixed(2)}</span>
                              {similar.mrp > similar.price && <span className="text-[10px] text-foreground/30 line-through">₹{similar.mrp.toFixed(2)}</span>}
                            </div>
                            <div className="mt-2.5 flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                              <Eye className="w-3 h-3" strokeWidth={1.5} /> Quick View
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Footer />
    </div>
  );
}
