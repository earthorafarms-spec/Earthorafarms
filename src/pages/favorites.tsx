import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Link } from 'wouter';
import { Heart, ShoppingBag, Trash2, ArrowUpRight } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { useAuth } from '@/contexts/auth-context';
import { useCart } from '@/contexts/cart-context';
import { supabase } from '@/lib/supabase';
import { fetchPublicProducts } from '@/lib/api';
import type { Product } from '@/types';

export default function Favorites() {
  const { user } = useAuth();
  const { addToCart } = useCart();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    (supabase.from('favorite_details') as any)
      .select('product_id')
      .eq('user_email', user.email)
      .then(({ data, error }: { data: Array<Record<string, unknown>> | null; error: unknown }) => {
        if (!error && data) setFavoriteIds(new Set(data.map((d: Record<string, unknown>) => d.product_id as string)));
      });
  }, [user]);

  const { data: allProducts = [], isLoading } = useQuery<Product[]>({
    queryKey: ['public-products'],
    queryFn: fetchPublicProducts,
    staleTime: 1000 * 60 * 5,
  });

  const favorites = useMemo(() => allProducts.filter((p) => favoriteIds.has(p.id)), [allProducts, favoriteIds]);

  const handleRemove = async (productId: string) => {
    window.dispatchEvent(new CustomEvent('wishlist-changed', { detail: -1 }));
    setFavoriteIds((prev) => { const next = new Set(prev); next.delete(productId); return next; });
    await (supabase.from('favorite_details') as any).delete().eq('user_email', user?.email).eq('product_id', productId);
  };

  if (!user) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
        <Navbar />
        <section className="relative pt-36 pb-20 lg:pt-44 lg:pb-24 overflow-hidden bg-[#0E0E0E] text-white">
          <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10 text-center">
            <div className="w-16 h-16 rounded-full bg-white/10 text-rose-400 flex items-center justify-center mx-auto mb-6">
              <Heart className="w-8 h-8 fill-current" />
            </div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-dm font-normal tracking-[-0.05em] text-[40px] leading-[44px] sm:text-[60px] sm:leading-[56px] text-white mb-4"
            >
              Sign in to view your wishlist.
            </motion.h1>
            <p className="font-inter text-base text-white/60 mb-8 max-w-md mx-auto">
              Save your favorite botanical supplements and access them anytime across all your devices.
            </p>
            <Link
              href="/auth"
              className="inline-flex items-center gap-2 bg-white text-black px-8 py-4 rounded-xl font-inter font-medium text-base hover:bg-white/90 transition-colors shadow-xl"
            >
              <span>Sign In Now</span>
              <ArrowUpRight className="w-5 h-5" />
            </Link>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
      <Navbar />

      {/* ── Hero / Header ── */}
      <section className="relative pt-36 pb-16 lg:pt-44 lg:pb-20 overflow-hidden bg-[#0E0E0E] text-white">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="mb-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 font-dm font-medium text-xs sm:text-sm text-white/80 tracking-[0.05em] uppercase">
                <Heart className="w-3.5 h-3.5 text-rose-400 fill-current" />
                <span>Saved Products</span>
              </div>
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[44px] leading-[46px] sm:text-[68px] sm:leading-[64px] text-white">
                Your Favorites.
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="font-inter font-normal text-base text-white/55 max-w-[340px]"
            >
              {favorites.length} {favorites.length === 1 ? 'item' : 'items'} saved in your personal collection.
            </motion.p>
          </div>
        </div>
      </section>

      {/* ── Main Favorites Grid ── */}
      <section className="flex-1 py-16 lg:py-24">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-80 bg-[#FEFDF9] rounded-2xl animate-pulse border border-black/5" />
              ))}
            </div>
          ) : favorites.length === 0 ? (
            <div className="text-center py-24">
              <div className="w-16 h-16 rounded-full bg-black/5 text-black/30 flex items-center justify-center mx-auto mb-4">
                <Heart className="w-8 h-8" />
              </div>
              <h3 className="font-dm font-normal text-3xl text-black tracking-[-0.03em] mb-2">
                No favorites saved yet.
              </h3>
              <p className="font-inter text-sm text-black/50 mb-8">
                Explore our collection and click the heart icon to save products.
              </p>
              <Link
                href="/our-product"
                className="inline-flex items-center gap-2 bg-black text-white px-8 py-4 rounded-xl font-inter font-medium text-base hover:bg-black/85 transition-colors shadow-lg"
              >
                <span>Explore Products</span>
                <ArrowUpRight className="w-5 h-5" />
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 lg:gap-8">
              {favorites.map((p) => (
                <div
                  key={p.id}
                  className="bg-[#FEFDF9] rounded-2xl border border-black/5 overflow-hidden flex flex-col shadow-sm hover:shadow-xl transition-all duration-500 group"
                >
                  <div className="relative aspect-square bg-[#ECEDEC] flex items-center justify-center p-6">
                    <button
                      onClick={() => handleRemove(p.id)}
                      className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm border border-black/10 flex items-center justify-center text-rose-500 hover:bg-rose-500 hover:text-white transition-all shadow-sm"
                      title="Remove from favorites"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <img
                      src={p.imageMain}
                      alt={p.name}
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-700 ease-out"
                    />
                  </div>

                  <div className="p-6 flex flex-col flex-1 justify-between">
                    <div>
                      <h3 className="font-dm font-normal text-xl text-black tracking-[-0.03em] mb-1">
                        {p.name}
                      </h3>
                      <p className="font-inter text-xs text-black/40 uppercase tracking-wider mb-4">
                        {p.tag}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-black/8 flex items-center justify-between">
                      <span className="font-dm font-normal text-2xl text-black tracking-[-0.03em]">
                        ₹{p.price.toFixed(0)}
                      </span>
                      <button
                        onClick={() => addToCart({ id: p.id, name: p.name, price: p.price, image: p.imageMain })}
                        className="bg-black text-white px-4 py-2.5 rounded-xl font-inter font-medium text-xs flex items-center gap-2 hover:bg-black/85 transition-colors shadow-md"
                      >
                        <ShoppingBag className="w-4 h-4" />
                        <span>Add to Cart</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
