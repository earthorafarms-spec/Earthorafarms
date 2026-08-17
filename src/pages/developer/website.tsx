import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Globe, Key, BarChart3, Edit3, Check, Loader2, Save, BadgePercent, AlertCircle
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

type SeoData = {
  keywords: string;
  title: string;
  description: string;
};

export default function DeveloperWebsite() {
  const [seo, setSeo] = useState<SeoData>({
    keywords: "moringa, organic moringa, premium moringa tablets, health powder, earthora farms",
    title: "Earthora Farms | Premium Organic Moringa & Wellness Products",
    description: "Discover fresh farm harvested organic moringa leaf powders, tablets and wellness capsules at Earthora Farms. Processed directly from our sustainable Indian orchards.",
  });
  const [isEditingSeo, setIsEditingSeo] = useState(false);
  const [savingSeo, setSavingSeo] = useState(false);

  const [loadingStats, setLoadingStats] = useState(true);
  const [profitStats, setProfitStats] = useState({
    totalSales: 0,
    totalCogs: 0,
    totalOverhead: 0,
    netRevenue: 0,
    totalGst: 0,
    netProfit: 0,
    marginPct: 0,
  });

  const { toast } = useToast();

  const fetchWebsiteData = async () => {
    setLoadingStats(true);
    try {
      // 1. Fetch SEO from settings
      const { data: seoData } = await (supabase.from("admin_settings") as any)
        .select("value")
        .eq("key", "seo_config")
        .maybeSingle();

      if ((seoData as any)?.value) {
        try {
          setSeo(JSON.parse((seoData as any).value));
        } catch {
          // fallback
        }
      }

      // 2. Load orders and calculate profit and loss from real items
      const { data: orders, error: ordersErr } = await supabase
        .from("orders")
        .select("*, order_items(*, products(*))");

      if (ordersErr) throw ordersErr;

      let sales = 0;
      let cogs = 0;
      let overhead = 0;
      let netRev = 0;
      let gst = 0;

      orders?.forEach((o: any) => {
        const amount = Number(o.total_amount || 0);
        sales += amount;

        // compute net revenue & gst
        const taxable = amount / 1.18;
        netRev += taxable;
        gst += amount - taxable;

        // aggregate items cogs and overhead (simulated or fetched from products if available)
        o.order_items?.forEach((item: any) => {
          const qty = Number(item.quantity || 1);
          // Try to fetch custom cost values (cogs default 120, overhead 30 per unit if not entered)
          const itemCogs = Number(item.products?.actualCost || 120) * qty;
          const itemOverhead = Number(item.products?.overhead || 30) * qty;
          cogs += itemCogs;
          overhead += itemOverhead;
        });
      });

      const totalCost = cogs + overhead;
      const profit = netRev - totalCost;
      const margin = sales > 0 ? (profit / sales) * 100 : 0;

      setProfitStats({
        totalSales: Math.round(sales),
        totalCogs: Math.round(cogs),
        totalOverhead: Math.round(overhead),
        netRevenue: Math.round(netRev),
        totalGst: Math.round(gst),
        netProfit: Math.round(profit),
        marginPct: Number(margin.toFixed(1)),
      });

    } catch (err: any) {
      toast({ title: "Analytics loading error", description: err.message, variant: "destructive" });
    } finally {
      setLoadingStats(false);
    }
  };

  const handleSaveSeo = async () => {
    setSavingSeo(true);
    try {
      const { error } = await (supabase.from("admin_settings") as any)
        .upsert({ key: "seo_config", value: JSON.stringify(seo) }, { onConflict: "key" });

      if (error) throw error;

      setIsEditingSeo(false);
      toast({ title: "SEO parameters saved", description: "Successfully updated search engines keywords & metadata configuration." });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingSeo(false);
    }
  };

  useEffect(() => {
    fetchWebsiteData();
  }, []);

  return (
    <div className="space-y-8 font-sans">
      <div>
        <h2 className="text-xl font-serif font-bold text-white">Website Controls & Analytics</h2>
        <p className="text-xs text-slate-500 mt-1">Configure global search tags and review live operating financial health metrics.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* SEO Parameters Panel */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900/40 rounded-2xl border border-slate-800 p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center">
                  <Globe className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">SEO Keywords & Meta</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Edit crawler parameters index pages headers directly.</p>
                </div>
              </div>

              {!isEditingSeo ? (
                <button
                  onClick={() => setIsEditingSeo(true)}
                  className="flex items-center gap-1.5 h-8 px-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-semibold text-slate-300 hover:border-slate-700 transition-all hover:text-white"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Modify SEO</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsEditingSeo(false)}
                    className="h-8 px-3 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveSeo}
                    disabled={savingSeo}
                    className="flex items-center gap-1.5 h-8 px-3.5 bg-indigo-600 rounded-xl text-xs font-bold text-white shadow-lg shadow-indigo-500/10 hover:bg-indigo-500 transition-all disabled:opacity-50"
                  >
                    {savingSeo ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>Save Config</span>
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest block mb-2">Meta Title</label>
                <input
                  type="text"
                  disabled={!isEditingSeo}
                  value={seo.title}
                  onChange={(e) => setSeo({ ...seo, title: e.target.value })}
                  className="w-full h-11 px-4 bg-slate-950 border border-slate-800/80 rounded-xl outline-none text-slate-200 text-xs focus:border-indigo-500/50 disabled:opacity-50 disabled:bg-slate-950/40"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest block mb-2">Meta Description</label>
                <textarea
                  rows={3}
                  disabled={!isEditingSeo}
                  value={seo.description}
                  onChange={(e) => setSeo({ ...seo, description: e.target.value })}
                  className="w-full p-4 bg-slate-950 border border-slate-800/80 rounded-xl outline-none text-slate-200 text-xs resize-none focus:border-indigo-500/50 disabled:opacity-50 disabled:bg-slate-950/40"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest block mb-2">Target Keywords (Comma Separated)</label>
                <textarea
                  rows={2}
                  disabled={!isEditingSeo}
                  value={seo.keywords}
                  onChange={(e) => setSeo({ ...seo, keywords: e.target.value })}
                  className="w-full p-4 bg-slate-950 border border-slate-800/80 rounded-xl outline-none text-slate-200 text-xs resize-none focus:border-indigo-500/50 disabled:opacity-50 disabled:bg-slate-950/40"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Profit Loss Summary Card */}
        <div>
          <div className="bg-slate-900/40 rounded-2xl border border-slate-800 p-6 shadow-xl space-y-6 flex flex-col justify-between h-full">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Profit & Loss Health</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Calculated across aggregate checkout sales.</p>
                </div>
              </div>

              {loadingStats ? (
                <div className="h-44 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                </div>
              ) : (
                <div className="bg-slate-950/60 rounded-xl border border-slate-800 p-4 space-y-3 font-mono text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Gross Sales (INR):</span>
                    <span className="text-slate-200 font-semibold">₹{profitStats.totalSales.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">GST Collected:</span>
                    <span className="text-slate-200">₹{profitStats.totalGst.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800/80 pb-2 mb-2">
                    <span className="text-slate-500">Net Sales:</span>
                    <span className="text-slate-200 font-semibold">₹{profitStats.netRevenue.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Raw COGS (120/ea):</span>
                    <span className="text-rose-400/80">₹{profitStats.totalCogs.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800/80 pb-2 mb-2">
                    <span className="text-slate-500">Total Overhead:</span>
                    <span className="text-rose-400/80">₹{profitStats.totalOverhead.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-bold">Net Profit (INR):</span>
                    <span className={`font-bold ${profitStats.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      ₹{profitStats.netProfit.toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {!loadingStats && (
              <div className="bg-[#1b2a22] border border-emerald-500/10 rounded-xl p-3.5 flex items-center gap-3">
                <BadgePercent className="w-8 h-8 text-emerald-400 shrink-0" />
                <div>
                  <span className="text-[10px] font-bold text-emerald-500/80 uppercase font-mono block">Estimated Margin</span>
                  <span className="text-base font-bold text-white block">{profitStats.marginPct}% profit per bottle</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
