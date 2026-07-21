import { memo } from 'react';
import { motion, type Variants } from 'framer-motion';
import { Star, ShoppingCart, Zap, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Product } from '@/types';

const itemVars: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

interface ProductCardProps {
  product: Product;
  hoveredId: string | null;
  wishlist: Set<string>;
  onHover: (id: string | null) => void;
  onClick: () => void;
  onAddToCart: () => void;
  onBuyNow: () => void;
  onToggleWishlist: (e: React.MouseEvent) => void;
}

export const ProductCard = memo(function ProductCard({
  product: p,
  hoveredId,
  wishlist,
  onHover,
  onClick,
  onAddToCart,
  onBuyNow,
  onToggleWishlist,
}: ProductCardProps) {
  return (
    <motion.div
      variants={itemVars}
      onClick={onClick}
      onMouseEnter={() => onHover(p.id)}
      onMouseLeave={() => onHover(null)}
      className="bg-card rounded-xl border border-border/60 overflow-hidden flex flex-col transition-shadow duration-300 hover:shadow-md cursor-pointer"
    >
      <div className="relative aspect-square bg-white flex items-center justify-center p-6 border-b border-border/30">
        {p.imageMain ? (
          <img
            src={hoveredId === p.id && p.imageHover ? p.imageHover : p.imageMain}
            alt={p.name}
            className="w-full h-full object-contain transition-all duration-500"
            loading="lazy"
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
          onClick={onToggleWishlist}
          className="absolute top-3 right-3 p-2 bg-white rounded-full shadow-sm border border-border/40 hover:shadow-md transition-shadow"
          aria-label={wishlist.has(p.id) ? 'Remove from wishlist' : 'Add to wishlist'}
        >
          <Heart
            className={`w-4 h-4 transition-colors ${wishlist.has(p.id) ? 'fill-red-500 text-red-500' : 'text-foreground/40'}`}
            strokeWidth={1.5}
          />
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
                <Star
                  key={i}
                  className={`w-3 h-3 ${i < Math.round(p.rating) ? 'fill-accent text-accent' : 'text-border'}`}
                  strokeWidth={1.5}
                />
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
          <Button
            size="sm"
            className="flex-1 h-10 text-xs gap-1.5 bg-primary hover:bg-primary/90"
            onClick={(e) => { e.stopPropagation(); onAddToCart(); }}
          >
            <ShoppingCart className="w-3.5 h-3.5" strokeWidth={1.5} /> Add to Cart
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-10 text-xs gap-1 border-primary/40 text-primary hover:bg-primary/5"
            onClick={(e) => { e.stopPropagation(); onBuyNow(); }}
          >
            <Zap className="w-3.5 h-3.5" strokeWidth={1.5} /> Buy Now
          </Button>
        </div>
      </div>
    </motion.div>
  );
});
