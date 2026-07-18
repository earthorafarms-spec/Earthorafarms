import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import {
  TrendingUp, ShoppingCart, Package, MessageSquare, ChevronRight, Clock,
  Leaf, AlertCircle
} from "lucide-react";

const initialOrders = [
  { id: "#ORD-001", customer: "Priya Sharma", items: 2, total: 1298, status: "Delivered", date: "10 Jul 2026" },
  { id: "#ORD-002", customer: "Rahul Verma", items: 1, total: 699, status: "Shipped", date: "11 Jul 2026" },
  { id: "#ORD-003", customer: "Ananya Patel", items: 3, total: 1847, status: "Processing", date: "12 Jul 2026" },
  { id: "#ORD-004", customer: "Vikram Singh", items: 1, total: 449, status: "Pending", date: "13 Jul 2026" },
  { id: "#ORD-005", customer: "Meera Iyer", items: 2, total: 1398, status: "Delivered", date: "09 Jul 2026" },
  { id: "#ORD-006", customer: "Sneha Kapoor", items: 1, total: 799, status: "Shipped", date: "11 Jul 2026" },
];

function StatCard({ label, value, icon: Icon, trend, subtitle, delay }: { label: string; value: string; icon: React.ElementType; trend: string; subtitle: string; delay?: number }) {
  const isPositive = !trend.startsWith("-") && trend !== "0%";
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: delay ?? 0 }}
      className="group bg-card rounded-2xl border border-border/55 p-6 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:border-primary/20 transition-all duration-500 relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-24 h-24 bg-primary/2 rounded-full blur-2xl group-hover:bg-primary/5 transition-colors duration-500" />
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
          <Icon className="w-5 h-5 text-primary" strokeWidth={1.5} />
        </div>
        <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${isPositive ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isPositive ? "bg-green-500" : "bg-amber-500"}`} />
          {trend}
        </span>
      </div>
      <p className="text-3xl font-bold text-foreground tracking-tight mb-1">{value}</p>
      <p className="text-sm font-serif text-foreground/60">{label}</p>
      <p className="text-xs text-foreground/30 mt-1.5 flex items-center gap-1">
        <Clock className="w-3 h-3" />
        {subtitle}
      </p>
    </motion.div>
  );
}

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const [orders] = useState(initialOrders);
  const [activeMarket, setActiveMarket] = useState<string | null>(null);
  const [liveVisitors, setLiveVisitors] = useState(148);

  useEffect(() => {
    const timer = setInterval(() => {
      setLiveVisitors((prev) => {
        const change = Math.random() > 0.55 ? 1 : -1;
        const next = prev + change;
        return next > 80 ? (next < 250 ? next : 240) : 80;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const stats = useMemo(() => ({
    revenue: orders.filter((o) => o.status === "Delivered").reduce((s, o) => s + o.total, 0),
    ordersTotal: orders.length,
    productsTotal: 4,
    pendingReviews: 2,
  }), [orders]);

  return (
    <motion.div
      key="dashboard"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard label="Total Revenue" value={`₹${stats.revenue.toLocaleString()}`} icon={TrendingUp} trend="+12.5%" subtitle="vs last month" delay={0} />
        <StatCard label="Orders" value={String(stats.ordersTotal)} icon={ShoppingCart} trend="+8.2%" subtitle="6 new this week" delay={0.05} />
        <StatCard label="Products" value={String(stats.productsTotal)} icon={Package} trend="0%" subtitle="All active" delay={0.1} />
        <StatCard label="Pending Reviews" value={String(stats.pendingReviews)} icon={MessageSquare} trend={stats.pendingReviews > 0 ? `+${stats.pendingReviews}` : "0"} subtitle="Needs moderation" delay={0.15} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <motion.div className="lg:col-span-2 bg-white rounded-2xl border border-border/40 overflow-hidden shadow-sm flex flex-col">
          <div className="flex items-center justify-between px-6 py-5 border-b border-border/20">
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-accent" />
              <h2 className="text-sm font-serif font-bold text-foreground">Global Traffic & Markets</h2>
            </div>
            <span className="text-xs text-foreground/45 flex items-center gap-1.5 font-medium bg-[#fafaf8] border border-border/40 px-2.5 py-1 rounded-lg shrink-0">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="font-bold text-foreground transition-all duration-500">{liveVisitors}</span> active users
            </span>
          </div>

          <div className="p-6 flex flex-col md:flex-row gap-6 items-center flex-1">
            <div className="w-full md:w-[65%] h-[280px] relative bg-[#fafaf8] rounded-xl border border-border/40 p-4 flex items-center justify-center overflow-hidden shrink-0">
              <img
                src="/world-map.svg"
                alt="Global market map"
                className="w-full h-full object-contain select-none opacity-85"
                draggable={false}
              />

              <style>{`
                #world-map {
                  width: 100% !important;
                  height: 100% !important;
                  max-width: 100%;
                  max-height: 100%;
                }
                #world-map path {
                  fill: #d2d6d2 !important;
                  transition: fill 0.3s ease, opacity 0.3s ease;
                  pointer-events: auto;
                  cursor: pointer;
                }
                #world-map g {
                  fill: #d2d6d2 !important;
                }
                #world-map g path {
                  fill: #d2d6d2 !important;
                }
                ${activeMarket === "India" ? "#world-map #in, #world-map path#in { fill: var(--accent) !important; opacity: 1 !important; filter: drop-shadow(0 2px 8px rgba(217,163,83,0.3)); }" : ""}
                ${activeMarket === "United States" ? "#world-map #us path, #world-map path#us, #world-map #us { fill: var(--primary) !important; opacity: 1 !important; filter: drop-shadow(0 2px 8px rgba(27,67,50,0.3)); }" : ""}
                ${activeMarket === "United Kingdom" ? "#world-map #gb path, #world-map path#gb, #world-map #gb { fill: var(--primary) !important; opacity: 1 !important; filter: drop-shadow(0 2px 8px rgba(27,67,50,0.3)); }" : ""}
                ${activeMarket === "Germany" ? "#world-map #de, #world-map path#de { fill: var(--primary) !important; opacity: 1 !important; filter: drop-shadow(0 2px 8px rgba(27,67,50,0.3)); }" : ""}
              `}</style>
            </div>

            <div className="w-full md:flex-1 space-y-4 pr-1">
              <h3 className="text-xs font-bold text-foreground/45 uppercase tracking-wider">Top Markets</h3>
              <div className="space-y-4">
                {[
                  { name: "India", pct: 42, growth: "+14.2%", activeColor: "bg-accent" },
                  { name: "United States", pct: 28, growth: "+8.5%", activeColor: "bg-primary" },
                  { name: "United Kingdom", pct: 18, growth: "+4.1%", activeColor: "bg-primary" },
                  { name: "Germany", pct: 12, growth: "+2.3%", activeColor: "bg-primary" }
                ].map((market) => {
                  const isSelected = activeMarket === market.name;
                  return (
                    <div
                      key={market.name}
                      className={`space-y-1.5 p-2 rounded-xl transition-all duration-300 border border-transparent ${
                        isSelected ? "bg-primary/[0.04] border-primary/10 shadow-[0_2px_12px_rgba(0,0,0,0.01)] scale-[1.02]" : "hover:bg-primary/[0.01]"
                      }`}
                      onMouseEnter={() => setActiveMarket(market.name)}
                      onMouseLeave={() => setActiveMarket(null)}
                    >
                      <div className="flex justify-between items-center text-xs font-semibold">
                        <span className={`transition-colors duration-300 ${isSelected ? "text-primary" : "text-foreground/80"}`}>{market.name}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold transition-all ${
                            isSelected ? "bg-primary/10 text-primary" : "bg-green-50 text-green-600"
                          }`}>{market.growth}</span>
                          <span className={`transition-colors duration-300 ${isSelected ? "text-primary font-bold" : "text-foreground"}`}>{market.pct}%</span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-border/40 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${market.activeColor} ${
                            isSelected ? "brightness-95 scale-y-110 shadow-sm" : ""
                          }`}
                          style={{ width: `${market.pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          className="bg-white rounded-2xl border border-border/40 overflow-hidden shadow-sm flex flex-col"
        >
          <div className="flex items-center justify-between px-6 py-5 border-b border-border/20 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <h2 className="text-sm font-serif font-bold text-foreground">Recent Orders</h2>
            </div>
            <button onClick={() => setLocation("/admin/orders")} className="text-xs text-primary hover:text-primary/70 transition-colors font-medium flex items-center gap-1">
              View All
              <ChevronRight className="w-3 h-3" strokeWidth={1.5} />
            </button>
          </div>

          <div className="p-5 space-y-3">
            {orders.slice(-4).map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between p-4 rounded-xl border border-border/30 hover:border-primary/20 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)] transition-all duration-300 bg-[#fafaf8]/50 group/order cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-primary/5 flex items-center justify-center text-[10px] font-bold text-primary border border-primary/10 shrink-0 group-hover/order:bg-primary group-hover/order:text-white transition-colors duration-300">
                    {(order.customer || "User").split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase() || "U"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{order.customer || "Anonymous"}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-foreground/40">
                      <span className="font-mono bg-muted px-1 py-0.2 rounded font-medium">{order.id || "#ORD"}</span>
                      <span>•</span>
                      <span>{order.date || "Just now"}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-xs font-bold text-foreground">₹{order.total}</p>
                    <p className="text-[9px] text-foreground/40 mt-0.5">{order.items} unit{order.items !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="p-1 rounded-lg bg-[#fafaf8] group-hover/order:bg-primary/5 transition-colors">
                    <ChevronRight className="w-3.5 h-3.5 text-foreground/30 group-hover/order:text-primary transition-colors" strokeWidth={1.5} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
