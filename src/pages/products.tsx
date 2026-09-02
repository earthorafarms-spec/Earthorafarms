import { useState, useMemo, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Sparkles, Filter } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { ProductCard } from '@/components/products/ProductCard';
import { ProductCardSkeleton } from '@/components/products/ProductCardSkeleton';
import { ProductModal } from '@/components/products/ProductModal';
import { ReviewSection } from '@/components/products/ReviewSection';
import { useCart } from '@/contexts/cart-context';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { fetchPublicProducts, fetchReviews } from '@/lib/api';
import type { Product, Review } from '@/types';
import powderImg from "@assets/generated_images/product_powder.jpg";

const containerVars = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.12 } },
};

const sortOptions = ['Popularity', 'Price: Low to High', 'Price: High to Low', 'Rating'];

export default function Products() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [wishlist, setWishlist] = useState<Set<string>>(new Set());
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [modalImage, setModalImage] = useState<string>('');
  const [sortOpen, setSortOpen] = useState(false);
  const [sortBy, setSortBy] = useState('Popularity');
  const [reviewName, setReviewName] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');

  const { addToCart } = useCart();
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!user) {
      const saved = localStorage.getItem('earthora-wishlist');
      setWishlist(new Set(saved ? JSON.parse(saved) : []));
      return;
    }
    (supabase.from('favorite_details') as any)
      .select('product_id')
      .eq('user_email', user.email)
      .then(({ data, error }: { data: Array<Record<string, unknown>> | null; error: unknown }) => {
        if (!error && data) {
          setWishlist(new Set(data.map((d: Record<string, unknown>) => d.product_id as string)));
        }
      });
  }, [user]);

  const { data: dbReviews = [], refetch: refetchReviews } = useQuery<any[]>({
    queryKey: ['product-reviews'],
    queryFn: fetchReviews,
    staleTime: 1000 * 60 * 5,
  });

  const reviewsMap = useMemo(() => {
    const map: Record<string, Review[]> = {};
    for (const r of dbReviews) {
      if (!map[r.review_product_id]) map[r.review_product_id] = [];
      map[r.review_product_id].push({
        name: r.review_user_id,
        rating: Number(r.review_rating) || 5,
        comment: r.review_comment,
        date: new Date(r.review_created_at).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        }),
      });
    }
    return map;
  }, [dbReviews]);

  const { data: rawProducts = [], isLoading } = useQuery<Product[]>({
    queryKey: ['public-products'],
    queryFn: fetchPublicProducts,
    staleTime: 1000 * 60 * 5,
  });

  const sortedProducts = useMemo(() => {
    const list = [...rawProducts];
    switch (sortBy) {
      case 'Price: Low to High': return list.sort((a, b) => a.price - b.price);
      case 'Price: High to Low': return list.sort((a, b) => b.price - a.price);
      case 'Rating': return list.sort((a, b) => b.rating - a.rating);
      default: return list;
    }
  }, [sortBy, rawProducts]);

  const handleAddToCart = useCallback((p: Product) => {
    addToCart({ id: p.id, name: p.name, price: p.price, image: p.imageMain });
    toast({ title: 'Added to cart', description: `${p.name} has been added to your cart.` });
  }, [addToCart, toast]);

  const [, setLocation] = useLocation();

  const handleBuyNow = useCallback((p: Product) => {
    addToCart({ id: p.id, name: p.name, price: p.price, image: p.imageMain });
    setLocation('/checkout');
  }, [addToCart, setLocation]);

  const handleSubmitReview = useCallback(async (productId: string) => {
    if (!reviewName.trim() || !reviewComment.trim()) return;
    try {
      const { error } = await (supabase.from('review_details') as any).insert({
        review_product_id: productId,
        review_user_id: reviewName.trim(),
        review_rating: String(reviewRating),
        review_comment: reviewComment.trim(),
      });
      if (error) throw error;
      setReviewName('');
      setReviewRating(5);
      setReviewComment('');
      toast({ title: 'Review submitted', description: 'Thank you for your feedback!' });
      refetchReviews();
    } catch (err: any) {
      toast({ title: 'Failed to submit review', description: err.message, variant: 'destructive' });
    }
  }, [reviewName, reviewRating, reviewComment, toast, refetchReviews]);

  const toggleWishlist = useCallback(async (id: string) => {
    if (!user) {
      setWishlist((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        localStorage.setItem('earthora-wishlist', JSON.stringify(Array.from(next)));
        return next;
      });
      return;
    }
    const isFav = wishlist.has(id);
    const delta = isFav ? -1 : 1;
    window.dispatchEvent(new CustomEvent('wishlist-changed', { detail: delta }));
    setWishlist((prev) => {
      const next = new Set(prev);
      isFav ? next.delete(id) : next.add(id);
      return next;
    });
    const { error } = isFav
      ? await (supabase.from('favorite_details') as any).delete().eq('user_email', user.email).eq('product_id', id)
      : await (supabase.from('favorite_details') as any).insert({ user_email: user.email, product_id: id });
    if (error) {
      toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
      window.dispatchEvent(new CustomEvent('wishlist-changed', { detail: -delta }));
      setWishlist((prev) => {
        const next = new Set(prev);
        isFav ? next.add(id) : next.delete(id);
        return next;
      });
    }
  }, [user, wishlist, toast]);

  const openProduct = useCallback((p: Product) => {
    setSelectedProduct(p);
    setModalImage(p.imageMain);
  }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
      <Navbar />

      {/* ── UNIQUE HERO: Split Showcase Hero (Light warm background + Floating Product Spotlight) ── */}
      <section className="relative pt-32 lg:pt-36 pb-16 lg:pb-20 overflow-hidden bg-[#F4F3EE] border-b border-black/8">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10">
          <div className="grid lg:grid-cols-12 gap-10 items-center">
            {/* Left Content */}
            <div className="lg:col-span-7">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/5 border border-black/10 font-dm font-medium text-xs text-black/70 uppercase tracking-wider"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>Harvest Catalog</span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
                className="font-dm font-normal tracking-[-0.05em] text-[44px] leading-[46px] sm:text-[64px] sm:leading-[60px] lg:text-[80px] lg:leading-[74px] text-black mb-6"
              >
                Pure Moringa. <br />
                <span className="text-black/40">Crafted for your daily ritual.</span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="font-inter font-normal text-base sm:text-lg text-black/65 max-w-xl leading-relaxed mb-8"
              >
                100% organic, shade-dried, nutrient-dense Moringa oleifera direct from our volcanic-soil farm. Zero fillers or binders.
              </motion.p>
            </div>

            {/* Right Product Spotlight Feature Box — shows first available product */}
            {(() => {
              const featured = rawProducts.find(p => p.badge) || rawProducts[0];
              if (!featured) return null;
              return (
                <div className="lg:col-span-5 hidden lg:block">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                    onClick={() => { setSelectedProduct(featured); setModalImage(featured.imageMain); }}
                    className="bg-[#FEFDF9] rounded-3xl border border-black/10 p-8 shadow-xl relative overflow-hidden flex items-center gap-6 cursor-pointer hover:shadow-2xl hover:border-black/20 transition-all duration-300"
                  >
                    <div className="w-40 h-40 rounded-2xl bg-[#ECEDEC] overflow-hidden shrink-0 flex items-center justify-center p-4">
                      <img src={featured.imageMain || powderImg} alt={featured.name} className="w-full h-full object-contain" />
                    </div>
                    <div>
                      <span className="px-3 py-1 rounded-full bg-emerald-800 text-white font-inter text-xs font-medium uppercase tracking-wider block w-fit mb-2">
                        {featured.badge || 'Farm Favorite'}
                      </span>
                      <h3 className="font-dm text-2xl text-black font-normal tracking-[-0.03em] mb-1">
                        {featured.name}
                      </h3>
                      <p className="font-inter text-xs text-black/50 mb-3 line-clamp-2">
                        {featured.description || featured.tag}
                      </p>
                      <span className="font-dm text-xl font-normal text-black block">
                        ₹{featured.price.toFixed(0)}
                      </span>
                    </div>
                  </motion.div>
                </div>
              );
            })()}
          </div>
        </div>
      </section>

      {/* ── Sort Toolbar ── */}
      <section className="bg-[#FAF9F5] border-b border-black/8 sticky top-0 z-10 backdrop-blur-sm">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="flex items-center justify-between gap-4 py-4">
            <p className="font-inter text-sm text-black/50 flex items-center gap-2">
              <Filter className="w-4 h-4 text-black/40" />
              <span>Showing <strong className="text-black font-medium">{isLoading ? '…' : sortedProducts.length}</strong> Products</span>
            </p>

            <div className="flex items-center gap-3 relative">
              <span className="hidden sm:block font-inter text-xs text-black/40 uppercase tracking-wider font-medium">Sort By:</span>
              <button
                onClick={() => setSortOpen(!sortOpen)}
                className="flex items-center gap-2 font-inter text-sm bg-[#FEFDF9] border border-black/10 rounded-xl px-4 py-2 text-black hover:border-black/25 transition-colors min-w-[160px]"
              >
                <span className="flex-1 text-left">{sortBy}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-black/30 transition-transform duration-300 ${sortOpen ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {sortOpen && (
                  <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.97 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute top-full right-0 mt-2 w-52 z-20 bg-[#FEFDF9] border border-black/8 rounded-2xl shadow-2xl overflow-hidden"
                    >
                      {sortOptions.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => { setSortBy(opt); setSortOpen(false); }}
                          className={`w-full flex items-center gap-3 px-5 py-3 font-inter text-sm text-left transition-colors hover:bg-[#ECEDEC] ${sortBy === opt ? 'text-black font-medium' : 'text-black/55'}`}
                        >
                          <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${sortBy === opt ? 'border-black bg-black' : 'border-black/20'}`}>
                            {sortBy === opt && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
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
        </div>
      </section>

      {/* ── Product Grid ── */}
      <section className="flex-1 py-12 lg:py-16">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <motion.div
            variants={containerVars}
            initial="hidden"
            animate={isLoading ? 'hidden' : 'show'}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 lg:gap-8"
          >
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={i} />)
              : sortedProducts.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  hoveredId={hoveredId}
                  wishlist={wishlist}
                  onHover={setHoveredId}
                  onClick={() => openProduct(p)}
                  onAddToCart={() => handleAddToCart(p)}
                  onBuyNow={() => handleBuyNow(p)}
                  onToggleWishlist={(e) => { e.stopPropagation(); toggleWishlist(p.id); }}
                />
              ))
            }
          </motion.div>

          {!isLoading && sortedProducts.length === 0 && (
            <div className="text-center py-32">
              <p className="font-dm text-4xl text-black/15 tracking-[-0.03em] mb-3">No products yet.</p>
              <p className="font-inter text-sm text-black/35">Check back soon — something pure is on its way.</p>
            </div>
          )}
        </div>
      </section>

      <ProductModal
        product={selectedProduct}
        modalImage={modalImage}
        onClose={() => setSelectedProduct(null)}
        onSetImage={setModalImage}
        onAddToCart={selectedProduct ? () => handleAddToCart(selectedProduct!) : () => {}}
        onBuyNow={selectedProduct ? () => handleBuyNow(selectedProduct!) : () => {}}
        similarProducts={sortedProducts.filter((p) => p.id !== selectedProduct?.id)}
        onSelectSimilar={openProduct}
      />

      {selectedProduct && (
        <ReviewSection
          reviews={reviewsMap[selectedProduct.id] || []}
          reviewName={reviewName}
          reviewRating={reviewRating}
          reviewComment={reviewComment}
          onNameChange={setReviewName}
          onRatingChange={setReviewRating}
          onCommentChange={setReviewComment}
          onSubmit={() => handleSubmitReview(selectedProduct.id)}
        />
      )}

      <Footer />
    </div>
  );
}
