import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, ShoppingCart, Zap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Product } from '@/types';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface ProductModalProps {
  product: Product | null;
  modalImage: string;
  onClose: () => void;
  onSetImage: (src: string) => void;
  onAddToCart: () => void;
  onBuyNow: () => void;
  similarProducts: Product[];
  onSelectSimilar: (p: Product) => void;
}

export const ProductModal = memo(function ProductModal({
  product,
  modalImage,
  onClose,
  onSetImage,
  onAddToCart,
  onBuyNow,
  similarProducts,
  onSelectSimilar,
}: ProductModalProps) {
  useEscapeKey(onClose, !!product);

  if (!product) return null;

  return (
    <AnimatePresence>
      {product && (
        <>
          <motion.div
            key={`backdrop-${product.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            key={product.id}
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 md:inset-x-8 md:inset-y-6 z-50 bg-background md:rounded-2xl overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-6 md:px-10 h-16 border-b border-border/30 shrink-0">
              <h2 className="text-sm font-serif text-foreground truncate">{product.name}</h2>
              <button onClick={onClose} className="p-2 rounded-full hover:bg-muted transition-colors">
                <X className="w-5 h-5 text-foreground/60" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col lg:flex-row">
                <div className="lg:w-[45%] bg-[#fafaf8] p-8 lg:p-12 flex flex-col items-center justify-start border-b lg:border-b-0 lg:border-r border-border/20">
                  <div className="w-full max-w-md aspect-square relative flex items-center justify-center">
                    <img
                      src={modalImage || product.imageMain}
                      alt={product.name}
                      className="w-full h-full object-contain drop-shadow-sm"
                    />
                  </div>
                  <div className="flex gap-3 mt-6">
                    {[product.imageMain, product.imageHover].filter(Boolean).map((src, i) => (
                      <button
                        key={i}
                        onClick={() => onSetImage(src)}
                        className={`w-16 h-16 rounded-xl border-2 overflow-hidden bg-white p-2 hover:border-primary/40 transition-colors ${modalImage === src ? 'border-primary' : 'border-border/40'}`}
                      >
                        <img src={src} alt="" className="w-full h-full object-contain" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="lg:w-[55%] p-6 md:p-10">
                  <div className="max-w-xl">
                    {product.badge && (
                      <span className="inline-block px-3 py-1 text-[11px] font-bold bg-primary text-primary-foreground rounded-md mb-5 tracking-wider uppercase">
                        {product.badge}
                      </span>
                    )}
                    <h1 className="text-2xl md:text-3xl font-serif text-foreground leading-tight mb-2">{product.name}</h1>
                    <p className="text-sm text-foreground/40 mb-5">{product.tag}</p>

                    <div className="flex items-center gap-3 mb-6 pb-6 border-b border-border/20">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-foreground bg-accent/20 px-2 py-0.5 rounded-md">{product.rating}</span>
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={`w-4 h-4 ${i < Math.round(product.rating) ? 'fill-accent text-accent' : 'text-border'}`} strokeWidth={1.5} />
                          ))}
                        </div>
                      </div>
                      {product.reviewCount > 0 && <span className="text-sm text-foreground/40">{product.reviewCount} ratings</span>}
                      <span className="text-foreground/20">|</span>
                      <span className="text-sm text-green-700 font-medium">{product.stock}</span>
                    </div>

                    <div className="flex items-baseline gap-3 mb-6">
                      <span className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">₹{product.price.toFixed(2)}</span>
                      {product.mrp > product.price && <span className="text-lg text-foreground/30 line-through">₹{product.mrp.toFixed(2)}</span>}
                      {product.discount > 0 && <span className="text-sm font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-md">-{product.discount}%</span>}
                    </div>

                    <div className="mb-6">
                      <h3 className="text-xs font-semibold text-foreground/50 uppercase tracking-widest mb-3">About this item</h3>
                      <p className="text-sm text-foreground/70 leading-relaxed mb-4">{product.description}</p>
                      <ul className="space-y-2.5">
                        {product.highlights.map((h) => (
                          <li key={h} className="text-sm text-foreground/60 flex items-start gap-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-2 shrink-0" />
                            {h}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="flex gap-3 pt-6 border-t border-border/20">
                      <Button className="flex-1 h-13 text-sm gap-2.5 bg-primary hover:bg-primary/90 rounded-xl" onClick={onAddToCart}>
                        <ShoppingCart className="w-4 h-4" strokeWidth={1.5} /> Add to Cart
                      </Button>
                      <Button variant="outline" className="flex-1 h-13 text-sm gap-2.5 border-primary/30 text-primary hover:bg-primary/5 rounded-xl" onClick={onBuyNow}>
                        <Zap className="w-4 h-4" strokeWidth={1.5} /> Buy Now
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {similarProducts.length > 0 && (
                <div className="border-t border-border/20 px-6 md:px-12 py-10">
                  <div className="max-w-5xl mx-auto">
                    <h3 className="text-lg font-serif text-foreground mb-6">You may also like</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                      {similarProducts.slice(0, 4).map((similar) => (
                        <button
                          key={similar.id}
                          onClick={() => onSelectSimilar(similar)}
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
                                  <Star key={i} className={`w-2.5 h-2.5 ${i < Math.round(similar.rating) ? 'fill-accent text-accent' : 'text-border'}`} strokeWidth={1.5} />
                                ))}
                              </div>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-sm font-bold text-foreground">₹{similar.price.toFixed(2)}</span>
                              {similar.mrp > similar.price && <span className="text-[10px] text-foreground/30 line-through">₹{similar.mrp.toFixed(2)}</span>}
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
        </>
      )}
    </AnimatePresence>
  );
});
