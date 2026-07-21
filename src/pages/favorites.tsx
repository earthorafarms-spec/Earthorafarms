import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Link } from 'wouter';
import { Heart, ShoppingBag, Trash2 } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
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
      <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
        <Navbar />
        <section className="relative pt-40 pb-16 overflow-hidden bg-primary">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05)_0,transparent_70%)]" />
          <div className="container mx-auto px-6 max-w-7xl relative z-10">
            <div className="max-w-3xl">
              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
                className="text-4xl md:text-6xl font-serif text-primary-foreground leading-[1.1] tracking-tight"
              >
                Sign in to see your favorites.
              </motion.h1>
            </div>
          </div>
        </section>
        <section className="flex-1 flex items-center justify-center py-20 bg-background">
          <div className="text-center max-w-md px-6 mx-auto">
            <Heart className="w-16 h-16 text-border mx-auto mb-6" strokeWidth={1} />
            <h2 className="text-3xl font-serif text-foreground mb-3">Your wishlist awaits</h2>
            <p className="text-foreground/75 font-light mb-8 leading-relaxed">
              Log in to save your favorite products and find them here later.
            </p>
            <Link href="/auth">
              <Button size="lg" className="h-14 px-8 text-base">Log In</Button>
            </Link>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  if (favorites.length === 0 && !isLoading) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
        <Navbar />
        <section className="relative pt-40 pb-16 overflow-hidden bg-primary">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05)_0,transparent_70%)]" />
          <div className="container mx-auto px-6 max-w-7xl relative z-10">
            <div className="max-w-3xl">
              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
                className="text-4xl md:text-6xl font-serif text-primary-foreground leading-[1.1] tracking-tight"
              >
                No favorites yet.
              </motion.h1>
            </div>
          </div>
        </section>
        <section className="flex-1 flex items-center justify-center py-20 bg-background">
          <div className="text-center max-w-md px-6 mx-auto">
            <Heart className="w-16 h-16 text-border mx-auto mb-6" strokeWidth={1} />
            <h2 className="text-3xl font-serif text-foreground mb-3">Heart the things you love</h2>
            <p className="text-foreground/75 font-light mb-8 leading-relaxed">
              Tap the heart icon on any product to save it here for quick access.
            </p>
            <Link href="/our-product">
              <Button size="lg" className="h-14 px-8 text-base">Browse Products</Button>
            </Link>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/20">
      <Navbar />

      <section className="relative pt-40 pb-16 overflow-hidden bg-primary">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05)_0,transparent_70%)]" />
        <div className="container mx-auto px-6 max-w-7xl relative z-10">
          <div className="max-w-3xl">
            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="text-4xl md:text-6xl font-serif text-primary-foreground leading-[1.1] tracking-tight mb-4"
            >
              Your favorites.
              <br />
              <span className="text-secondary/90 italic">{favorites.length} product{favorites.length !== 1 ? 's' : ''}</span>
            </motion.h1>
          </div>
        </div>
      </section>

      <section className="py-16 bg-background">
        <div className="container mx-auto px-6 max-w-5xl">
          <div className="space-y-4">
            {favorites.map((p) => (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-5 bg-card rounded-xl p-5 border border-border/50"
              >
                <div className="w-24 h-24 rounded-xl bg-white border border-border/30 flex items-center justify-center p-3 shrink-0">
                  {p.imageMain ? (
                    <img src={p.imageMain} alt={p.name} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-2xl">🌿</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-foreground truncate">{p.name}</h3>
                  <p className="text-xs text-foreground/40 mt-0.5">{p.tag}</p>
                  <p className="text-lg font-bold text-foreground mt-2">₹{p.price.toFixed(2)}</p>
                  <div className="flex items-center gap-3 mt-3">
                    <Button
                      size="sm"
                      className="h-9 text-xs gap-1.5"
                      onClick={() => addToCart({ id: p.id, name: p.name, price: p.price, image: p.imageMain })}
                    >
                      <ShoppingBag className="w-3.5 h-3.5" strokeWidth={1.5} /> Add to Cart
                    </Button>
                    <button
                      onClick={() => handleRemove(p.id)}
                      className="p-1.5 text-foreground/30 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
