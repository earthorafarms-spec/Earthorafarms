import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import {
  TrendingUp, ShoppingCart, Package, MessageSquare, ChevronRight, Clock
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

type MarketData = { name: string; pct: number; growth: string; visitors: number };

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
  const [orders, setOrders] = useState<any[]>([]);
  const [activeMarket, setActiveMarket] = useState<string | null>(null);
  const [liveVisitors, setLiveVisitors] = useState(0);
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [mapSvg, setMapSvg] = useState<string>("");
  const [stats, setStats] = useState({
    revenue: 0,
    ordersTotal: 0,
    productsTotal: 0,
    pendingReviews: 0,
  });
  const { toast } = useToast();

  const fetchDashboardData = async () => {
    try {

      const { data: rawOrders, error: orderErr } = await supabase
        .from("orders")
        .select("*, order_items(*)");

      if (orderErr) throw orderErr;

      const { data: rawProducts, error: prodErr } = await supabase
        .from("products")
        .select("id")
        .neq("status", "archived");

      if (prodErr) throw prodErr;

      // Count low stock products via inventory check
      const { data: rawInventory, error: invErr } = await supabase
        .from("inventory")
        .select("id, total_stock, low_stock_threshold");

      if (invErr) throw invErr;

      const dbOrders = rawOrders as any[];
      const dbProducts = rawProducts as any[];
      const dbInventory = rawInventory as any[];

      const lowStockCount = dbInventory ? dbInventory.filter((i: any) => i.total_stock <= i.low_stock_threshold).length : 0;

      const mappedOrders = dbOrders.map((o: any) => {
        const itemsCount = o.order_items ? o.order_items.reduce((acc: number, item: any) => acc + (item.quantity || 0), 0) : 0;
        return {
          id: o.order_number || o.id,
          customer: (o.shipping_address as any)?.name || "Customer",
          items: itemsCount,
          total: Number(o.total_amount),
          status: o.status,
          date: new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
        };
      });

      setOrders(mappedOrders);

      const totalRevenue = dbOrders
        .reduce((sum: number, o: any) => sum + Number(o.total_amount || 0), 0);

      setStats({
        revenue: totalRevenue,
        ordersTotal: dbOrders.length,
        productsTotal: dbProducts.length,
        pendingReviews: lowStockCount, // display low stock products count in review spot or alert
      });

    } catch (err: any) {
      console.error("Dashboard load error:", err);
    }
  };

  const fetchMarkets = async () => {
    try {
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

      const { data: pageViews, error: pvErr } = await supabase
        .from("Admin_analytics")
        .select("visitor_country, visitor_created_at")
        .gte("visitor_created_at", twoYearsAgo.toISOString());

      if (pvErr) throw pvErr;

      const { data: orderCountries, error: ocErr } = await supabase
        .from("orders")
        .select("shipping_address, created_at")
        .gte("created_at", twoYearsAgo.toISOString());

      if (ocErr) throw ocErr;

      const countryTraffic: Record<string, number> = {};
      const countryOrders: Record<string, number> = {};
      let totalTraffic = 0;

      if (pageViews) {
        for (const ev of pageViews as any[]) {
          const country = ev.visitor_country || "Unknown";
          countryTraffic[country] = (countryTraffic[country] || 0) + 1;
          totalTraffic++;
        }
      }

      if (orderCountries) {
        for (const o of orderCountries as any[]) {
          const country = (o.shipping_address as any)?.country || "India";
          countryOrders[country] = (countryOrders[country] || 0) + 1;
        }
      }

      const allCountries = new Set([...Object.keys(countryTraffic), ...Object.keys(countryOrders)]);
      const combined: { name: string; traffic: number; orders: number }[] = [];

      for (const name of allCountries) {
        if (name === "Unknown" || !name) continue;
        combined.push({
          name,
          traffic: countryTraffic[name] || 0,
          orders: countryOrders[name] || 0,
        });
      }

      combined.sort((a, b) => (b.orders !== a.orders ? b.orders - a.orders : b.traffic - a.traffic));
      const top = combined.slice(0, 6);

      if (top.length === 0) {
        setMarkets([
          { name: "India", pct: 100, growth: "No orders yet", visitors: totalTraffic || 0 },
        ]);
        setLiveVisitors(0);
        return;
      }

      const maxTraffic = Math.max(...top.map((m) => m.traffic), 1);
      setMarkets(
        top.map((m) => ({
          name: m.name,
          pct: Math.round((m.traffic / maxTraffic) * 100),
          growth: m.orders > 0 ? `+${m.orders} orders` : "No orders",
          visitors: m.traffic,
        }))
      );

      const recentMinutes = 30;
      const recentCutoff = new Date(Date.now() - recentMinutes * 60 * 1000).toISOString();

      const { count: recentSessions } = await supabase
        .from("Admin_analytics")
        .select("id", { count: "exact", head: true })
        .gte("visitor_created_at", recentCutoff);

      setLiveVisitors(recentSessions || 0);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    fetchDashboardData();
    fetchMarkets();
  }, []);

  useEffect(() => {
    fetch("/world-map.svg")
      .then((res) => res.text())
      .then((text) => {
        const cleaned = text.replace(/<\?xml.*\?>/g, "").replace(/<!DOCTYPE.*>/g, "");
        setMapSvg(cleaned);
      })
      .catch((err) => console.error("Error loading world map:", err));
  }, []);

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
              {mapSvg ? (
                <div
                  className="w-full h-full flex items-center justify-center select-none pointer-events-auto cursor-pointer"
                  dangerouslySetInnerHTML={{ __html: mapSvg }}
                  onMouseOver={(e) => {
                    const target = e.target as SVGElement;
                    const path = target.closest("path");
                    if (!path) return;
                    const id = path.id || path.parentElement?.id;
                    if (id === "in") setActiveMarket("India");
                    else if (id === "us") setActiveMarket("United States");
                    else if (id === "gb") setActiveMarket("United Kingdom");
                    else if (id === "de") setActiveMarket("Germany");
                  }}
                  onMouseOut={() => setActiveMarket(null)}
                />
              ) : (
                <div className="text-xs text-foreground/30 animate-pulse font-serif">Loading Map...</div>
              )}

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
                {markets.length === 0 ? (
                  <div className="text-center py-8 text-foreground/30">
                    <p className="text-xs font-medium">No traffic data yet</p>
                    <p className="text-[10px] mt-1">Page views will appear here once tracked</p>
                  </div>
                ) : markets.map((market) => {
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
                          <span className="text-[10px] text-foreground/50 font-mono">{market.visitors.toLocaleString()} visits</span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-border/40 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${market.name === "India" ? "bg-accent" : "bg-primary"} ${
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
            <button onClick={() => setLocation("/sun-earthora/orders")} className="text-xs text-primary hover:text-primary/70 transition-colors font-medium flex items-center gap-1">
              View All
              <ChevronRight className="w-3 h-3" strokeWidth={1.5} />
            </button>
          </div>

          <div className="p-5 space-y-3">
            {orders.length === 0 ? (
              <div className="text-center py-12 text-foreground/40 text-xs">
                No orders yet.
              </div>
            ) : (
              orders.slice(-4).map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-4 rounded-xl border border-border/30 hover:border-primary/20 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)] transition-all duration-300 bg-[#fafaf8]/50 group/order cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-primary/5 flex items-center justify-center text-[10px] font-bold text-primary border border-primary/10 shrink-0 group-hover/order:bg-primary group-hover/order:text-white transition-colors duration-300">
                      {(order.customer || "User").split(" ").filter(Boolean).map((n: string) => n[0]).join("").toUpperCase() || "U"}
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
              ))
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
