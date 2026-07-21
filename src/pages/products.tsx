import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
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

  const handleBuyNow = useCallback((p: Product) => {
    addToCart({ id: p.id, name: p.name, price: p.price, image: p.imageMain });
    toast({ title: 'Added to cart!', description: 'Proceed to checkout.' });
  }, [addToCart, toast]);

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
              The Earthora<br /><span className="text-secondary/90 italic">collection.</span>
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
              <span className="text-foreground font-medium">{isLoading ? '\u2026' : sortedProducts.length}</span> products
            </p>
            <div className="flex items-center gap-3 relative">
              <span className="text-xs text-foreground/40 uppercase tracking-wider">Sort by:</span>
              <button
                onClick={() => setSortOpen(!sortOpen)}
                className="flex items-center gap-2 text-sm bg-background border border-border/60 rounded-lg px-3 py-1.5 text-foreground hover:border-primary/40 transition-colors min-w-[140px]"
              >
                <span className="flex-1 text-left">{sortBy}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-foreground/40 transition-transform duration-300 ${sortOpen ? 'rotate-180' : ''}`} />
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
                          className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors hover:bg-muted ${sortBy === opt ? 'text-foreground font-medium' : 'text-foreground/60'}`}
                        >
                          <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${sortBy === opt ? 'border-primary' : 'border-border'}`}>
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

          <motion.div
            variants={containerVars} initial="hidden" animate={isLoading ? 'hidden' : 'show'}
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
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
            <div className="text-center py-20 text-foreground/40">
              <p className="text-sm">No products available yet. Check back soon.</p>
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
