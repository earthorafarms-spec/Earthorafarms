import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useAuth } from "./auth-context";
import { supabase } from "@/lib/supabase";

export interface CartItem {
  id: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (item: Omit<CartItem, "quantity">) => void;
  removeFromCart: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  cartCount: number;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem("earthora-cart");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Sync state to local storage as fallback
  useEffect(() => {
    localStorage.setItem("earthora-cart", JSON.stringify(items));
  }, [items]);

  // Load cart from DB upon user login
  useEffect(() => {
    if (!user) return;

    supabase
      .from("Cart_details")
      .select("*")
      .eq("cart_user_id", user.email)
      .then(async ({ data }) => {
        if (data && data.length > 0) {
          const resolvedItems: CartItem[] = [];
          for (const row of data) {
            const { data: prod } = await supabase
              .from("products")
              .select("*")
              .eq("slug", row.cart_product_id)
              .single();

            resolvedItems.push({
              id: row.cart_product_id,
              name: prod?.name || row.cart_product_id,
              price: Number(row.cart_product_price),
              image: prod?.images?.[0]?.url || "",
              quantity: Number(row.cart_product_quantity),
            });
          }
          setItems(resolvedItems);
        }
      });
  }, [user]);

  const addToCart = (product: Omit<CartItem, "quantity">) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });

    if (user) {
      supabase
        .from("Cart_details")
        .select("*")
        .eq("cart_user_id", user.email)
        .eq("cart_product_id", product.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            supabase
              .from("Cart_details")
              .update({ cart_product_quantity: String(Number(data.cart_product_quantity) + 1) })
              .eq("id", data.id)
              .then();
          } else {
            supabase
              .from("Cart_details")
              .insert({
                cart_user_id: user.email,
                cart_product_id: product.id,
                cart_product_quantity: "1",
                cart_product_price: String(product.price),
              })
              .then();
          }
        });
    }
  };

  const removeFromCart = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));

    if (user) {
      supabase
        .from("Cart_details")
        .delete()
        .eq("cart_user_id", user.email)
        .eq("cart_product_id", id)
        .then();
    }
  };

  const updateQuantity = (id: string, quantity: number) => {
    if (quantity < 1) return removeFromCart(id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity } : i)));

    if (user) {
      supabase
        .from("Cart_details")
        .update({ cart_product_quantity: String(quantity) })
        .eq("cart_user_id", user.email)
        .eq("cart_product_id", id)
        .then();
    }
  };

  const clearCart = () => {
    setItems([]);

    if (user) {
      supabase
        .from("Cart_details")
        .delete()
        .eq("cart_user_id", user.email)
        .then();
    }
  };

  const cartCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, updateQuantity, clearCart, cartCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
