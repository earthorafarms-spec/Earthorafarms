import { motion } from "framer-motion";
import { Link } from "wouter";
import { Trash2, Minus, Plus, ShoppingBag, ArrowLeft } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/cart-context";

export default function Cart() {
  const { items, removeFromCart, updateQuantity, clearCart, cartCount } = useCart();

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  if (items.length === 0) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
        <Navbar />
        
        {/* Header Hero */}
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
                Your cart is empty.
              </motion.h1>
            </div>
          </div>
        </section>

        {/* Content Body */}
        <section className="flex-1 flex items-center justify-center py-20 bg-background">
          <div className="text-center max-w-md px-6 mx-auto">
            <ShoppingBag className="w-16 h-16 text-border mx-auto mb-6" strokeWidth={1} />
            <h2 className="text-3xl font-serif text-foreground mb-3">Time to find your ritual</h2>
            <p className="text-foreground/75 font-light mb-8 leading-relaxed">
              Looks like you haven't added anything yet. Browse our premium moringa collection to get started.
            </p>
            <Link href="/our-product">
              <Button size="lg" className="h-14 px-8 text-base">Shop Our Collection</Button>
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
              Your cart.
              <br />
              <span className="text-secondary/90 italic">{cartCount} item{cartCount !== 1 ? "s" : ""}</span>
            </motion.h1>
          </div>
        </div>
      </section>

      <section className="py-16 bg-background">
        <div className="container mx-auto px-6 max-w-5xl">
          <div className="flex flex-col lg:flex-row gap-10">
            <div className="flex-1 space-y-4">
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-5 bg-card rounded-xl p-5 border border-border/50"
                >
                  <div className="w-24 h-24 rounded-xl bg-white border border-border/30 flex items-center justify-center p-3 shrink-0">
                    <img src={item.image} alt={item.name} className="w-full h-full object-contain" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-foreground truncate">{item.name}</h3>
                    <p className="text-lg font-bold text-foreground mt-1">₹{(item.price * item.quantity).toFixed(2)}</p>
                    <div className="flex items-center gap-3 mt-3">
                      <div className="flex items-center border border-border/60 rounded-lg">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="p-1.5 hover:bg-muted transition-colors rounded-l-lg"
                        >
                          <Minus className="w-3.5 h-3.5 text-foreground/60" />
                        </button>
                        <span className="w-8 text-center text-sm font-medium text-foreground">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="p-1.5 hover:bg-muted transition-colors rounded-r-lg"
                        >
                          <Plus className="w-3.5 h-3.5 text-foreground/60" />
                        </button>
                      </div>
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="p-1.5 text-foreground/30 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
              <button onClick={clearCart} className="text-xs text-foreground/30 hover:text-foreground/60 transition-colors">
                Clear cart
              </button>
            </div>

            <div className="lg:w-80">
              <div className="bg-card rounded-xl p-6 border border-border/50 sticky top-28">
                <h3 className="text-sm font-semibold text-foreground mb-4">Order Summary</h3>
                <div className="space-y-2 text-sm mb-4">
                  <div className="flex justify-between text-foreground/60">
                    <span>Subtotal</span>
                    <span>₹{subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-foreground/60">
                    <span>Shipping</span>
                    <span className="text-green-700">FREE</span>
                  </div>
                </div>
                <div className="border-t border-border/40 pt-4 mb-6">
                  <div className="flex justify-between text-base font-semibold text-foreground">
                    <span>Total</span>
                    <span>₹{subtotal.toFixed(2)}</span>
                  </div>
                </div>
                <Button className="w-full h-12 text-sm mb-3">Proceed to Checkout</Button>
                <Link href="/our-product">
                  <span className="flex items-center justify-center gap-1.5 text-xs text-foreground/40 hover:text-foreground/70 transition-colors cursor-pointer">
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Continue Shopping
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
