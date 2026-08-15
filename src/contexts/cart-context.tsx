import { createContext, useContext, useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { supabase } from '@/lib/supabase';
import { getDiscountedPrice, fetchActiveDeals } from '@/lib/api';
import type { CartItem, FestiveDeal } from '@/types';
import powderImg from '@assets/generated_images/product_powder.jpg';

interface CartContextType {
  items: CartItem[];
  addToCart: (item: Omit<CartItem, 'quantity'>) => void;
  removeFromCart: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  cartCount: number;
}

const CART_KEY = 'earthora-cart';

const CartContext = createContext<CartContextType | null>(null);

// Helper to consolidate items by ID or Name into single combined entries with summed quantities
function consolidateCartItems(rawItems: CartItem[]): CartItem[] {
  if (!rawItems || rawItems.length === 0) return [];
  const map = new Map<string, CartItem>();

  for (const item of rawItems) {
    if (!item) continue;
    // Key by ID or Name to catch identical products added under different IDs or names
    const key = (item.id || item.name || "").trim().toLowerCase();
    if (!key) continue;

    const existing = map.get(key);
    if (existing) {
      existing.quantity += Number(item.quantity || 1);
    } else {
      map.set(key, { ...item, quantity: Number(item.quantity || 1) });
    }
  }

  return Array.from(map.values());
}

function loadCart(): CartItem[] {
  try {
    const saved = localStorage.getItem(CART_KEY);
    return saved ? consolidateCartItems(JSON.parse(saved)) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>(loadCart);
  const [deals, setDeals] = useState<FestiveDeal[]>([]);

  useEffect(() => {
    fetchActiveDeals().then(setDeals).catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(consolidateCartItems(items)));
  }, [items]);

  useEffect(() => {
    const email = user?.email;
    if (!email) return;

    const abort = new AbortController();

    (supabase.from('Cart_details') as any)
      .select('*')
      .eq('cart_user_id', email)
      .then(async ({ data }: { data: Record<string, unknown>[] | null }) => {
        if (!data || data.length === 0 || abort.signal.aborted) return;

        const rawResolved: CartItem[] = [];
        for (const row of data) {
          const { data: prod } = await (supabase.from('products') as any)
            .select('*')
            .or(`id.eq.${row.cart_product_id},slug.eq.${row.cart_product_id}`)
            .maybeSingle();

          const basePrice = Number(prod?.price || row.cart_product_price);
          const images = (prod?.images as Record<string, unknown>[]) || [];
          const discounted = getDiscountedPrice(
            (prod?.id as string) || (row.cart_product_id as string),
            basePrice,
            deals
          );

          const imgUrl = (images[0]?.url as string) || '';
          const fallbackImg = powderImg;

          rawResolved.push({
            id: (prod?.id as string) || (row.cart_product_id as string),
            name: (prod?.name as string) || (row.cart_product_id as string),
            price: discounted,
            image: imgUrl && !imgUrl.includes('undefined') ? imgUrl : fallbackImg,
            quantity: Number(row.cart_product_quantity || 1),
          });
        }
        const consolidated = consolidateCartItems(rawResolved);
        if (!abort.signal.aborted) setItems(consolidated);
      })
      .catch(() => {});

    return () => abort.abort();
  }, [user, deals]);

  useEffect(() => {
    if (items.length === 0 || deals.length === 0) return;

    (supabase.from('products') as any)
      .select('id, slug, price')
      .then(({ data }: { data: Record<string, unknown>[] }) => {
        if (!data) return;
        setItems((prev) => {
          let changed = false;
          const next = prev.map((item) => {
            const dbProd = data.find(
              (p: Record<string, unknown>) => p.id === item.id || p.slug === item.id || p.id === item.name
            );
            if (!dbProd) return item;
            const originalPrice = Number(dbProd.price);
            const discounted = Math.min(
              getDiscountedPrice(dbProd.id as string, originalPrice, deals),
              getDiscountedPrice(dbProd.slug as string, originalPrice, deals)
            );
            if (item.price !== discounted) {
              changed = true;
              return { ...item, price: discounted };
            }
            return item;
          });
          return changed ? consolidateCartItems(next) : prev;
        });
      })
      .catch(() => {});
  }, [deals]);

  const addToCart = useCallback(
    (product: Omit<CartItem, 'quantity'>) => {
      setItems((prev) => {
        const prodKey = (product.id || product.name || "").trim().toLowerCase();
        const existingIndex = prev.findIndex(
          (i) => (i.id || i.name || "").trim().toLowerCase() === prodKey
        );

        if (existingIndex >= 0) {
          const next = prev.map((item, idx) =>
            idx === existingIndex ? { ...item, quantity: item.quantity + 1 } : item
          );
          return consolidateCartItems(next);
        }

        return consolidateCartItems([...prev, { ...product, quantity: 1 }]);
      });

      const email = user?.email;
      if (email) {
        (supabase.from('Cart_details') as any)
          .select('*')
          .eq('cart_user_id', email)
          .eq('cart_product_id', product.id)
          .then(({ data }: { data: Record<string, unknown>[] | null }) => {
            if (data && data.length > 0) {
              const mainRow = data[0];
              const totalQty = data.reduce(
                (acc, r) => acc + Number(r.cart_product_quantity || 1),
                0
              );
              (supabase.from('Cart_details') as any)
                .update({ cart_product_quantity: String(totalQty + 1) })
                .eq('id', mainRow.id)
                .then(() => {});

              if (data.length > 1) {
                const duplicateIds = data.slice(1).map((r) => r.id);
                (supabase.from('Cart_details') as any)
                  .delete()
                  .in('id', duplicateIds)
                  .then(() => {});
              }
            } else {
              (supabase.from('Cart_details') as any)
                .insert({
                  cart_user_id: email,
                  cart_product_id: product.id,
                  cart_product_quantity: '1',
                  cart_product_price: String(product.price),
                })
                .then(() => {});
            }
          });
      }
    },
    [user?.email]
  );

  const removeFromCart = useCallback(
    (id: string) => {
      const matchKey = (id || "").trim().toLowerCase();
      setItems((prev) =>
        prev.filter((i) => (i.id || i.name || "").trim().toLowerCase() !== matchKey)
      );

      const email = user?.email;
      if (email) {
        (supabase.from('Cart_details') as any)
          .delete()
          .eq('cart_user_id', email)
          .eq('cart_product_id', id)
          .then(() => {});
      }
    },
    [user?.email]
  );

  const updateQuantity = useCallback(
    (id: string, quantity: number) => {
      if (quantity < 1) return removeFromCart(id);
      const matchKey = (id || "").trim().toLowerCase();

      setItems((prev) =>
        consolidateCartItems(
          prev.map((i) =>
            (i.id || i.name || "").trim().toLowerCase() === matchKey
              ? { ...i, quantity }
              : i
          )
        )
      );

      const email = user?.email;
      if (email) {
        (supabase.from('Cart_details') as any)
          .update({ cart_product_quantity: String(quantity) })
          .eq('cart_user_id', email)
          .eq('cart_product_id', id)
          .then(() => {});
      }
    },
    [user?.email, removeFromCart]
  );

  const clearCart = useCallback(() => {
    setItems([]);
    const email = user?.email;
    if (email) {
      (supabase.from('Cart_details') as any)
        .delete()
        .eq('cart_user_id', email)
        .then(() => {});
    }
  }, [user?.email]);

  const cartCount = useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items]);

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, updateQuantity, clearCart, cartCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextType {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}
