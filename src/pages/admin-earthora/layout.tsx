import { useState, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import {
  LayoutDashboard, Package, ShoppingCart, TrendingUp, Tag, LogOut, Leaf, ChevronRight,
  Inbox, Search, Menu, X, Sparkles, Settings
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const navItems = [
  { id: "dashboard",  label: "Dashboard",     icon: LayoutDashboard, path: "/admin-earthora/dashboard" },
  { id: "products",   label: "Products",       icon: Package,         path: "/admin-earthora/products" },
  { id: "orders",     label: "Orders",         icon: ShoppingCart,    path: "/admin-earthora/orders" },
  { id: "coupons",    label: "Coupons",        icon: Tag,             path: "/admin-earthora/coupons" },
  { id: "festive",    label: "Festive Deals",  icon: Sparkles,        path: "/admin-earthora/festive" },
  { id: "analytics", label: "Analytics",      icon: TrendingUp,      path: "/admin-earthora/analytics" },
  { id: "settings",  label: "Settings",       icon: Settings,        path: "/admin-earthora/settings" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { toast } = useToast();

  const activeTab = location.replace("/admin-earthora/", "").replace("/admin-earthora", "") || "dashboard";

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-primary text-primary-foreground">
      <div className="flex items-center h-20 px-6 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shadow-inner">
            <Leaf className="w-5 h-5 text-accent" strokeWidth={2} />
          </div>
          <div>
            <span className="font-serif text-lg font-bold tracking-tight text-white block">Earthora</span>
            <span className="text-[10px] text-white/40 font-medium tracking-wider uppercase">Console Panel</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-6 px-4 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setLocation(item.path);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 relative group ${
                isActive
                  ? "text-primary bg-[#fafaf8] shadow-md"
                  : "text-white/70 hover:text-white hover:bg-white/5"
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="activeBar"
                  className="absolute left-0 top-1/4 bottom-1/4 w-1 rounded-r-full bg-primary"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <item.icon className={`w-[18px] h-[18px] transition-transform duration-300 group-hover:scale-110 ${isActive ? "text-primary" : "text-white/60"}`} strokeWidth={1.75} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10 bg-black/10">
        <div className="flex items-center gap-3 px-3 py-2.5 mb-2 rounded-xl bg-white/5">
          <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-xs font-bold text-primary shadow-md">
            A
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-white truncate">Administrator</p>
            <p className="text-[10px] text-white/40 truncate">admin@earthora.com</p>
          </div>
        </div>
        <button
          onClick={() => {
            // Sign out of the session and redirect
            sessionStorage.removeItem("admin_authenticated");
            sessionStorage.removeItem("admin_password");
            localStorage.removeItem("admin_session");
            toast({ title: "Signed Out", description: "You have been logged out of the session." });
            setLocation("/");
          }}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-all"
        >
          <LogOut className="w-[17px] h-[17px] text-white/40" strokeWidth={1.75} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] flex bg-[#fafaf8] text-foreground selection:bg-primary/20">
      <aside className="hidden lg:block w-64 bg-primary shrink-0 relative z-30 shadow-xl">
        <div className="sticky top-0 h-screen flex flex-col">
          <SidebarContent />
        </div>
      </aside>

      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="fixed top-0 bottom-0 left-0 w-64 bg-primary z-50 lg:hidden flex flex-col shadow-2xl"
            >
              <SidebarContent />
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="absolute top-5 right-4 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="flex-1 flex flex-col min-h-screen min-w-0">
        <header className="h-20 bg-white border-b border-border/30 flex items-center justify-between px-6 md:px-10 sticky top-0 z-20 shadow-sm shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-xl hover:bg-muted text-foreground/60 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base font-serif text-foreground font-semibold capitalize leading-tight">{activeTab}</h1>
              <div className="flex items-center gap-1.5 text-xs text-foreground/30 mt-0.5">
                <span>Console</span>
                <ChevronRight className="w-3 h-3" strokeWidth={1.5} />
                <span className="text-foreground/50">{activeTab}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2.5 bg-[#fafaf8] rounded-xl px-3.5 py-2 border border-border/40 focus-within:border-primary/30 focus-within:bg-white transition-all">
              <Search className="w-3.5 h-3.5 text-foreground/30" strokeWidth={1.5} />
              <input type="text" placeholder="Search Console..." className="bg-transparent text-xs text-foreground outline-none w-36 placeholder:text-foreground/30" />
            </div>
            <div className="relative p-2 rounded-xl hover:bg-[#fafaf8] transition-colors cursor-pointer">
              <div className="w-2 h-2 rounded-full bg-accent absolute top-1 right-1 ring-2 ring-white" />
              <Inbox className="w-5 h-5 text-foreground/50 hover:text-foreground transition-colors" strokeWidth={1.5} />
            </div>
            <span className="text-foreground/15">|</span>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-full bg-primary/5 border border-primary/10 flex items-center justify-center p-0.5">
                <div className="w-full h-full rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white shadow-inner">
                  A
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 p-6 md:p-10 max-w-7xl w-full mx-auto">
          <Suspense fallback={
            <div className="flex items-center justify-center h-48">
              <div className="flex flex-col items-center gap-3">
                <div className="w-7 h-7 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                <span className="text-xs text-foreground/30 font-medium">Loading…</span>
              </div>
            </div>
          }>
            {children}
          </Suspense>
        </div>
      </main>
    </div>
  );
}
