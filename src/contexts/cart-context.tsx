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

function loadCart(): CartItem[] {
  try {
    const saved = localStorage.getItem(CART_KEY);
    return saved ? JSON.parse(saved) : [];
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
    localStorage.setItem(CART_KEY, JSON.stringify(items));
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

        const resolvedItems: CartItem[] = [];
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

          resolvedItems.push({
            id: row.cart_product_id as string,
            name: (prod?.name as string) || (row.cart_product_id as string),
            price: discounted,
            image: imgUrl && !imgUrl.includes('undefined') ? imgUrl : fallbackImg,
            quantity: Number(row.cart_product_quantity),
          });
        }
        if (!abort.signal.aborted) setItems(resolvedItems);
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
              (p: Record<string, unknown>) => p.id === item.id || p.slug === item.id
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
          return changed ? next : prev;
        });
      })
      .catch(() => {});
  }, [deals]);

  const addToCart = useCallback(
    (product: Omit<CartItem, 'quantity'>) => {
      setItems((prev) => {
        const existing = prev.find((i) => i.id === product.id);
        if (existing) {
          return prev.map((i) =>
            i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
          );
        }
        return [...prev, { ...product, quantity: 1 }];
      });

      const email = user?.email;
      if (email) {
        (supabase.from('Cart_details') as any)
          .select('*')
          .eq('cart_user_id', email)
          .eq('cart_product_id', product.id)
          .maybeSingle()
          .then(({ data }: { data: Record<string, unknown> | null }) => {
            if (data) {
              (supabase.from('Cart_details') as any)
                .update({ cart_product_quantity: String(Number(data.cart_product_quantity) + 1) })
                .eq('id', data.id)
                .then(() => {});
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
      setItems((prev) => prev.filter((i) => i.id !== id));
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
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity } : i)));
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
