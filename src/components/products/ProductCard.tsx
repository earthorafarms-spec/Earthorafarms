import { memo } from 'react';
import { motion, type Variants } from 'framer-motion';
import { Star, ShoppingBag, ArrowUpRight, Heart } from 'lucide-react';
import type { Product } from '@/types';

const itemVars: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
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
      className="group bg-[#FEFDF9] rounded-2xl border border-black/5 overflow-hidden flex flex-col shadow-sm hover:shadow-2xl hover:-translate-y-1.5 transition-all duration-500 cursor-pointer"
    >
      {/* Image */}
      <div className="relative aspect-square bg-[#ECEDEC] flex items-center justify-center p-8 overflow-hidden">
        {p.badge && (
          <span className="absolute top-4 left-4 z-10 px-3.5 py-1.5 rounded-full font-inter font-medium text-xs tracking-[-0.01em] shadow-sm bg-black text-white">
            {p.badge}
          </span>
        )}
        <button
          onClick={onToggleWishlist}
          className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm border border-black/10 flex items-center justify-center shadow-sm hover:shadow-md transition-all"
          aria-label={wishlist.has(p.id) ? 'Remove from wishlist' : 'Add to wishlist'}
        >
          <Heart
            className={`w-4 h-4 transition-colors ${wishlist.has(p.id) ? 'fill-red-500 text-red-500' : 'text-black/40'}`}
            strokeWidth={1.5}
          />
        </button>

        {p.imageMain ? (
          <img
            src={hoveredId === p.id && p.imageHover ? p.imageHover : p.imageMain}
            alt={p.name}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-700 ease-out drop-shadow-md"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-5xl">🌿</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-6 flex flex-col flex-1">
        {/* Rating row */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => {
              const filled = i + 1 <= p.rating;
              const half = !filled && i < p.rating;
              return (
                <span key={i} className="relative inline-block w-3.5 h-3.5">
                  <Star className="w-3.5 h-3.5 text-black/15 absolute inset-0" strokeWidth={1} />
                  {(filled || half) && (
                    <span className="absolute inset-0 overflow-hidden" style={{ width: filled ? '100%' : '50%' }}>
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" strokeWidth={1} />
                    </span>
                  )}
                </span>
              );
            })}
          </div>
          <span className="font-inter text-xs text-black/40">
            {p.rating} {p.reviewCount > 0 && `(${p.reviewCount})`}
          </span>
        </div>

        {/* Title */}
        <h3 className="font-dm font-normal text-xl text-black tracking-[-0.03em] leading-tight mb-1 line-clamp-2">
          {p.name}
        </h3>
        <p className="font-inter text-xs uppercase tracking-wider text-black/35 font-medium mb-4">
          {p.tag}
        </p>

        {/* Stock */}
        <p className={`font-inter text-xs font-medium flex items-center gap-1.5 mb-4 ${p.stock === 'Out of Stock' ? 'text-red-600' : 'text-emerald-700'}`}>
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${p.stock === 'Out of Stock' ? 'bg-red-600' : 'bg-emerald-600'}`} />
          {p.stock}
        </p>

        {/* Price & Buttons */}
        <div className="mt-auto pt-4 border-t border-black/8 flex items-center justify-between gap-3">
          <div>
            <span className="font-dm font-normal text-2xl text-black tracking-[-0.03em]">
              ₹{p.price.toFixed(0)}
            </span>
            {p.mrp > p.price && (
              <span className="font-inter text-xs text-black/35 line-through ml-2">
                ₹{p.mrp.toFixed(0)}
              </span>
            )}
            {p.discount > 0 && (
              <span className="ml-2 text-xs font-inter font-medium text-emerald-700">
                {p.discount}% off
              </span>
            )}
          </div>

          {p.stock === 'Out of Stock' ? (
            <span className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 text-xs font-medium rounded-xl shrink-0">
              Out of Stock
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onAddToCart(); }}
                className="bg-black text-white w-10 h-10 rounded-xl flex items-center justify-center hover:bg-black/80 transition-colors shadow-md shrink-0 group/btn"
                aria-label="Add to cart"
              >
                <ShoppingBag className="w-4 h-4 group-hover/btn:scale-110 transition-transform" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onBuyNow(); }}
                className="border border-black/15 text-black/80 hover:text-black hover:border-black/30 w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0 group/btn2"
                aria-label="Buy now"
              >
                <ArrowUpRight className="w-4 h-4 group-hover/btn2:translate-x-0.5 group-hover/btn2:-translate-y-0.5 transition-transform" />
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
});
