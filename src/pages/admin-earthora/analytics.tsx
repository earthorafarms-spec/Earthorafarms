import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp, ShoppingCart, Eye, Clock, Search, ArrowUpRight, ArrowDownRight,
  Globe, ChevronRight, Calendar, Loader2, IndianRupee, Package
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const timeframeOptions = ["Last 7 days", "Last 30 days", "Last 90 days"];

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function StatCard({ label, value, icon: Icon, trend, isPositive, loading }: {
  label: string; value: string; icon: React.ElementType;
  trend?: string; isPositive?: boolean; loading?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="group bg-card rounded-2xl border border-border/50 p-6 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:border-primary/20 transition-all duration-500"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-12 h-12 rounded-xl bg-primary/8 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
          <Icon className="w-5 h-5 text-primary" strokeWidth={1.5} />
        </div>
        {trend && (
          <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${isPositive ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {isPositive ? <ArrowUpRight className="w-3 h-3" strokeWidth={2} /> : <ArrowDownRight className="w-3 h-3" strokeWidth={2} />}
            {trend}
          </span>
        )}
      </div>
      {loading ? (
        <div className="h-8 w-20 bg-muted/50 rounded-lg animate-pulse mb-1" />
      ) : (
        <p className="text-3xl font-bold text-foreground tracking-tight mb-0.5">{value}</p>
      )}
      <p className="text-sm text-foreground/50 font-medium">{label}</p>
    </motion.div>
  );
}

export default function AdminAnalytics() {
  const [timeframe, setTimeframe] = useState("Last 30 days");
  const [timeframeOpen, setTimeframeOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [totalOrders, setTotalOrders] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalProducts, setTotalProducts] = useState(0);
  const [pageViews, setPageViews] = useState(0);
  const [pageViewsTrend, setPageViewsTrend] = useState({ value: "", isPositive: true });
  const [ordersTrend, setOrdersTrend] = useState({ value: "", isPositive: true });
  const [monthlyViews, setMonthlyViews] = useState<{ month: string; views: number }[]>([]);
  const [trafficSources, setTrafficSources] = useState<{ source: string; count: number; percentage: number }[]>([]);

  const days = timeframe === "Last 7 days" ? 7 : timeframe === "Last 90 days" ? 90 : 30;

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const since = daysAgo(days);
      const previousSince = daysAgo(days * 2);

      // Page views
      const { count: currentViews } = await supabase
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "page_view")
        .gte("created_at", since);

      const { count: previousViews } = await supabase
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "page_view")
        .gte("created_at", previousSince)
        .lt("created_at", since);

      setPageViews(currentViews || 0);

      if (previousViews && previousViews > 0) {
        const change = ((currentViews! - previousViews) / previousViews) * 100;
        setPageViewsTrend({
          value: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
          isPositive: change >= 0,
        });
      }

      // Orders
      const { count: currentOrders } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since);

      const { count: previousOrders } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .gte("created_at", previousSince)
        .lt("created_at", since);

      setTotalOrders(currentOrders || 0);

      if (previousOrders && previousOrders > 0) {
        const change = ((currentOrders! - previousOrders) / previousOrders) * 100;
        setOrdersTrend({
          value: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
          isPositive: change >= 0,
        });
      }

      // Revenue
      const { data: revenueData } = await supabase
        .from("orders")
        .select("total_amount")
        .gte("created_at", since);

      const revenue = (revenueData as any[] || []).reduce((sum: number, o: any) => sum + Number(o.total_amount || 0), 0);
      setTotalRevenue(revenue);

      // Total products (active)
      const { count: productCount } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .neq("status", "archived");

      setTotalProducts(productCount || 0);

      // Monthly page views (last 6 months)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const { data: monthlyRaw } = await supabase
        .from("analytics_events")
        .select("created_at")
        .eq("event_type", "page_view")
        .gte("created_at", sixMonthsAgo.toISOString())
        .order("created_at", { ascending: true });

      if (monthlyRaw) {
        const byMonth: Record<string, number> = {};
        const months: { month: string; views: number }[] = [];

        for (let i = 5; i >= 0; i--) {
          const d = new Date();
          d.setMonth(d.getMonth() - i);
          const key = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
          const short = d.toLocaleDateString("en-US", { month: "short" });
          byMonth[key] = 0;
          months.push({ month: short, views: 0 });
        }

        for (const ev of monthlyRaw as any[]) {
          const d = new Date(ev.created_at);
          const key = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
          if (byMonth[key] !== undefined) {
            byMonth[key]++;
          }
        }

        const monthKeys = Object.keys(byMonth);
        setMonthlyViews(monthKeys.map((k, i) => ({ month: months[i]?.month || k.split(" ")[0], views: byMonth[k] })));
      }

      // Traffic sources (from platform field + properties)
      const { data: sourceRaw } = await supabase
        .from("analytics_events")
        .select("platform, properties")
        .gte("created_at", since)
        .limit(1000);

      if (sourceRaw) {
        const sourceMap: Record<string, number> = {};
        for (const ev of sourceRaw as any[]) {
          const source = ev.properties?.source || ev.platform || "Direct";
          sourceMap[source] = (sourceMap[source] || 0) + 1;
        }
        const total = Object.values(sourceMap).reduce((a, b) => a + b, 0);
        const sorted = Object.entries(sourceMap)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 6)
          .map(([source, count]) => ({
            source: source.charAt(0).toUpperCase() + source.slice(1),
            count,
            percentage: total > 0 ? Math.round((count / total) * 100) : 0,
          }));
        setTrafficSources(sorted);
      }
    } catch (err) {
      console.error("Analytics fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [timeframe]);

  const maxViews = Math.max(...monthlyViews.map((m) => m.views), 1);

  return (
    <motion.div
      key="analytics"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-lg font-serif font-bold text-foreground">Analytics Overview</h2>
          <p className="text-xs text-foreground/40 mt-0.5">Track your store performance and traffic patterns</p>
        </div>
        <div className="relative">
          <button
            onClick={() => setTimeframeOpen(!timeframeOpen)}
            className="flex items-center gap-2 bg-white border border-border/40 rounded-xl px-4 py-2.5 text-sm text-foreground/70 hover:border-primary/30 transition-all"
          >
            <Calendar className="w-4 h-4 text-foreground/40" strokeWidth={1.5} />
            {timeframe}
            <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${timeframeOpen ? "rotate-90" : ""}`} strokeWidth={1.5} />
          </button>
          {timeframeOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setTimeframeOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 w-44 bg-white rounded-xl border border-border/40 shadow-lg z-20 overflow-hidden">
                {timeframeOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => { setTimeframe(opt); setTimeframeOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-muted/50 ${
                      timeframe === opt ? "text-primary font-semibold bg-primary/5" : "text-foreground/60"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard label="Page Views" value={pageViews.toLocaleString()} icon={Eye} trend={pageViewsTrend.value} isPositive={pageViewsTrend.isPositive} loading={loading} />
        <StatCard label="Orders" value={totalOrders.toLocaleString()} icon={ShoppingCart} trend={ordersTrend.value} isPositive={ordersTrend.isPositive} loading={loading} />
        <StatCard label="Revenue" value={`₹${totalRevenue.toLocaleString()}`} icon={IndianRupee} loading={loading} />
        <StatCard label="Active Products" value={totalProducts.toLocaleString()} icon={Package} loading={loading} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-border/40 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-6 py-5 border-b border-border/20">
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <h2 className="text-sm font-serif font-bold text-foreground">Page Views Over Time</h2>
            </div>
            <span className="text-xs text-foreground/40">Last 6 months</span>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="h-48 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-foreground/30" />
              </div>
            ) : monthlyViews.length === 0 || monthlyViews.every(m => m.views === 0) ? (
              <div className="h-48 flex flex-col items-center justify-center text-foreground/30 gap-2">
                <Eye className="w-8 h-8" strokeWidth={1} />
                <p className="text-xs font-medium">No page view data yet</p>
              </div>
            ) : (
              <div className="flex items-end justify-between gap-3 h-48">
                {monthlyViews.map((m) => (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                    <span className="text-[10px] text-foreground/40 font-medium">
                      {m.views >= 1000 ? `${(m.views / 1000).toFixed(1)}k` : m.views || ""}
                    </span>
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max((m.views / maxViews) * 100, m.views > 0 ? 4 : 0)}%` }}
                      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                      className="w-full max-w-[48px] rounded-lg bg-gradient-to-t from-primary/60 to-primary/30 hover:from-primary hover:to-primary/50 transition-colors cursor-pointer relative group/bar"
                    >
                      {m.views > 0 && (
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-primary-foreground text-[10px] px-2 py-1 rounded-lg opacity-0 group-hover/bar:opacity-100 transition-opacity whitespace-nowrap shadow-lg">
                          {m.views.toLocaleString()} views
                        </div>
                      )}
                    </motion.div>
                    <span className="text-[11px] text-foreground/50 font-medium mt-1">{m.month}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-border/40 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-2.5 h-2.5 rounded-full bg-accent" />
            <h2 className="text-sm font-serif font-bold text-foreground">Traffic Sources</h2>
          </div>
          {loading ? (
            <div className="h-48 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-foreground/30" />
            </div>
          ) : trafficSources.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-foreground/30 gap-2">
              <Globe className="w-8 h-8" strokeWidth={1} />
              <p className="text-xs font-medium">No traffic data yet</p>
            </div>
          ) : (
            <div className="space-y-5">
              {trafficSources.map((source) => (
                <div key={source.source} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2.5">
                      <span className="text-foreground/70 text-xs font-medium">{source.source}</span>
                    </div>
                    <span className="text-xs font-bold text-foreground">{source.percentage}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-border/40 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${source.percentage}%` }}
                      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                      className="h-full rounded-full bg-primary"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-border/40 p-6 shadow-sm">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-2.5 h-2.5 rounded-full bg-primary" />
          <h2 className="text-sm font-serif font-bold text-foreground">Recent Orders</h2>
        </div>
        {loading ? (
          <div className="h-24 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-foreground/30" />
          </div>
        ) : totalOrders === 0 ? (
          <div className="h-24 flex flex-col items-center justify-center text-foreground/30 gap-2">
            <ShoppingCart className="w-8 h-8" strokeWidth={1} />
            <p className="text-xs font-medium">No orders in this period</p>
          </div>
        ) : (
          <div className="flex items-center gap-8">
            <div>
              <p className="text-3xl font-bold text-foreground tracking-tight">{totalOrders}</p>
              <p className="text-xs text-foreground/40 mt-0.5">Total orders in selected period</p>
            </div>
            <div className="w-px h-12 bg-border/40" />
            <div>
              <p className="text-3xl font-bold text-foreground tracking-tight">₹{totalRevenue.toLocaleString()}</p>
              <p className="text-xs text-foreground/40 mt-0.5">Revenue in selected period</p>
            </div>
            <div className="w-px h-12 bg-border/40" />
            <div>
              <p className="text-3xl font-bold text-foreground tracking-tight">{totalProducts}</p>
              <p className="text-xs text-foreground/40 mt-0.5">Active products</p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
