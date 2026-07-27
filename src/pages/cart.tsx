import { motion } from "framer-motion";
import { Link } from "wouter";
import { Trash2, Minus, Plus, ShoppingBag, ArrowUpRight } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useCart } from "@/contexts/cart-context";

export default function Cart() {
  const { items, removeFromCart, updateQuantity, clearCart, cartCount } = useCart();

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  if (items.length === 0) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
        <Navbar />
        
        {/* Header Hero */}
        <section className="relative pt-36 pb-20 lg:pt-44 lg:pb-24 overflow-hidden bg-[#0E0E0E] text-white">
          <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10 text-center">
            <div className="w-16 h-16 rounded-full bg-white/10 text-amber-300 flex items-center justify-center mx-auto mb-6">
              <ShoppingBag className="w-8 h-8" />
            </div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-dm font-normal tracking-[-0.05em] text-[40px] leading-[44px] sm:text-[60px] sm:leading-[56px] text-white mb-4"
            >
              Your cart is empty.
            </motion.h1>
            <p className="font-inter text-base text-white/60 mb-8 max-w-md mx-auto">
              Looks like you haven't added anything yet. Explore our botanical collection to find your daily ritual.
            </p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 bg-white text-black px-8 py-4 rounded-xl font-inter font-medium text-base hover:bg-white/90 transition-colors shadow-xl"
            >
              <span>Shop Collection</span>
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
                <ShoppingBag className="w-3.5 h-3.5 text-amber-300" />
                <span>Your Cart</span>
              </div>
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[44px] leading-[46px] sm:text-[68px] sm:leading-[64px] text-white">
                Review Your Order.
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="font-inter font-normal text-base text-white/55 max-w-[340px]"
            >
              {cartCount} {cartCount === 1 ? 'item' : 'items'} in your cart. Free shipping applies at checkout.
            </motion.p>
          </div>
        </div>
      </section>

      {/* ── Main Cart Section ── */}
      <section className="flex-1 py-16 lg:py-24">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-start">
            {/* Cart Items List */}
            <div className="lg:col-span-8 space-y-4">
              <div className="flex items-center justify-between pb-4 border-b border-black/10 font-inter text-xs text-black/40 uppercase tracking-wider font-medium">
                <span>Product</span>
                <button
                  onClick={clearCart}
                  className="hover:text-black transition-colors"
                >
                  Clear Cart
                </button>
              </div>

              {items.map((item) => (
                <div
                  key={item.id}
                  className="bg-[#FEFDF9] rounded-2xl p-4 sm:p-6 border border-black/5 flex flex-col sm:flex-row sm:items-center justify-between gap-6 shadow-sm"
                >
                  <div className="flex items-center gap-5">
                    <div className="w-20 h-20 rounded-xl bg-[#ECEDEC] overflow-hidden shrink-0 flex items-center justify-center p-2">
                      <img src={item.image} alt={item.name} className="w-full h-full object-contain" />
                    </div>
                    <div>
                      <h3 className="font-dm font-normal text-xl text-black tracking-[-0.02em] mb-1">
                        {item.name}
                      </h3>
                      <span className="font-dm text-lg text-black font-normal">
                        ₹{item.price.toFixed(0)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-6 pt-4 sm:pt-0 border-t sm:border-t-0 border-black/5">
                    <div className="flex items-center border border-black/15 rounded-xl bg-[#FAF9F5] p-1">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-black/60 hover:text-black hover:bg-black/5 transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-10 text-center font-inter text-sm font-medium">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-black/60 hover:text-black hover:bg-black/5 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <span className="font-dm text-xl text-black font-normal min-w-[80px] text-right">
                      ₹{(item.price * item.quantity).toFixed(0)}
                    </span>

                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="p-2 text-black/30 hover:text-rose-600 transition-colors"
                      title="Remove item"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Order Summary Sidebar */}
            <div className="lg:col-span-4">
              <div className="bg-[#FEFDF9] rounded-3xl p-8 border border-black/5 shadow-xl sticky top-28">
                <h3 className="font-dm font-normal text-2xl text-black tracking-[-0.03em] mb-6">
                  Order Summary
                </h3>

                <div className="space-y-4 font-inter text-sm mb-6 pb-6 border-b border-black/8">
                  <div className="flex justify-between text-black/60">
                    <span>Subtotal</span>
                    <span className="text-black font-medium">₹{subtotal.toFixed(0)}</span>
                  </div>
                  <div className="flex justify-between text-black/60">
                    <span>Shipping</span>
                    <span className="text-emerald-700 font-medium">Free</span>
                  </div>
                </div>

                <div className="flex justify-between items-baseline mb-8">
                  <span className="font-dm text-xl text-black font-medium">Total</span>
                  <span className="font-dm text-3xl text-black font-normal tracking-[-0.03em]">
                    ₹{subtotal.toFixed(0)}
                  </span>
                </div>

                <Link
                  href="/checkout"
                  className="w-full bg-black text-white py-4 rounded-xl font-inter font-medium text-base hover:bg-black/85 transition-colors shadow-lg flex items-center justify-center gap-2 group"
                >
                  <span>Proceed to Checkout</span>
                  <ArrowUpRight className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
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
