import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import {
  TrendingUp, ShoppingCart, ShieldCheck, Building2, Users, Receipt, ArrowUpRight, ArrowDownRight, Layers, FileSpreadsheet, RefreshCw
} from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function KaccDashboard() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    fetchOrders();
  }, []);

  async function fetchOrders() {
    setLoading(true);
    try {
      const { data, error } = await (supabase.from("orders") as any)
        .select("*, order_items(*)")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setOrders(data || []);
    } catch (err) {
      console.error("Failed to fetch KACC selling data:", err);
    } finally {
      setLoading(false);
    }
  }

  // Calculate Key Account Selling & Tax Analytics
  let totalRevenue = 0;
  let b2bRevenue = 0;
  let b2cRevenue = 0;
  let b2bCount = 0;
  let b2cCount = 0;

  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  const processedOrders = orders.map((o) => {
    let amount = Number(o.total_amount || 0);
    if (amount <= 0 && Array.isArray(o.order_items)) {
      amount = o.order_items.reduce((acc: number, item: any) => {
        return acc + (Number(item.total_price) || Number(item.unit_price) * Number(item.quantity) || 0);
      }, 0);
    }

    const addr = o.shipping_address || {};
    const customerName = o.customer_name || addr.name || o.user_id || "Customer";
    const customerEmail = o.customer_email || addr.email || o.user_id || "";
    const gstNo = (o.customer_gst || addr.gst || addr.user_gst || "").trim();
    const isB2B = Boolean(gstNo && gstNo.length >= 3);
    const state = (o.customer_state || addr.state || addr.user_state || "").trim().toLowerCase();

    // Tax computation (18% GST rate: 9% CGST + 9% SGST for intra-state Gujarat, 18% IGST for inter-state)
    const taxableValue = amount / 1.18;
    const taxAmount = amount - taxableValue;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    const isIntraState = state.includes("gujarat") || state === "gj" || state === "guj";

    if (isIntraState) {
      cgst = taxAmount / 2;
      sgst = taxAmount / 2;
    } else {
      igst = taxAmount;
    }

    totalRevenue += amount;
    if (isB2B) {
      b2bRevenue += amount;
      b2bCount++;
    } else {
      b2cRevenue += amount;
      b2cCount++;
    }

    totalCgst += cgst;
    totalSgst += sgst;
    totalIgst += igst;

    return {
      ...o,
      customerName,
      customerEmail,
      calculatedAmount: amount,
      taxableValue,
      isB2B,
      gstNo,
      state: o.customer_state || addr.state || "N/A",
      cgst,
      sgst,
      igst,
      taxAmount,
      category: isB2B ? "B2B (GST)" : "B2C (Retail)"
    };
  });

  const totalTaxCollected = totalCgst + totalSgst + totalIgst;

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="bg-[#0F2318] text-white p-8 rounded-3xl relative overflow-hidden shadow-xl border border-emerald-900/40">
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <span className="px-3 py-1 rounded-full bg-emerald-900/80 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono font-semibold uppercase tracking-wider mb-3 inline-block">
              Selling & GST Tax Analytics
            </span>
            <h1 className="text-3xl sm:text-4xl font-serif font-bold text-white tracking-tight">Key Accounts Overview</h1>
            <p className="text-sm text-emerald-200/70 mt-1 max-w-xl leading-relaxed">
              Real-time selling performance, invoice breakdowns (B2B vs B2C), and tax collections (CGST, SGST, IGST).
            </p>
          </div>

          <button
            onClick={fetchOrders}
            className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 transition-colors border border-white/10"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh Sales Data</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-black/50 uppercase tracking-wider font-mono">Gross Selling Value</span>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-bold font-dm text-black">₹{totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
          <div className="text-xs text-black/50 font-inter flex items-center gap-1">
            <span>Total Sales from {orders.length} orders</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-black/50 uppercase tracking-wider font-mono">B2B Revenue (GSTIN)</span>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-800 flex items-center justify-center">
              <Building2 className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-bold font-dm text-black">₹{b2bRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
          <div className="text-xs text-blue-700 font-medium flex items-center gap-1">
            <span>{b2bCount} B2B Registered Orders</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-black/50 uppercase tracking-wider font-mono">B2C Retail Sales</span>
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-800 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-bold font-dm text-black">₹{b2cRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
          <div className="text-xs text-purple-700 font-medium flex items-center gap-1">
            <span>{b2cCount} Non-GST Retail Orders</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-black/50 uppercase tracking-wider font-mono">Total Tax Collected</span>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-800 flex items-center justify-center">
              <Receipt className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-bold font-dm text-black">₹{totalTaxCollected.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
          <div className="text-xs text-amber-700 font-medium flex items-center gap-1">
            <span>CGST + SGST + IGST Output</span>
          </div>
        </div>
      </div>

      {/* Tax Breakdown Grid (CGST, SGST, IGST) */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-black/5 shadow-xs space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-dm font-bold text-black tracking-tight">GST Tax Categorization Summary</h2>
            <p className="text-xs text-black/55">Intra-State vs Inter-State Sales Output Tax</p>
          </div>
          <span className="px-3 py-1 rounded-full bg-black/5 text-black text-xs font-mono font-medium">
            Supplier State: Tamil Nadu
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-5 rounded-2xl bg-[#FAF9F5] border border-black/5 space-y-2">
            <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider block font-mono">CGST (Central Tax 9%)</span>
            <p className="text-2xl font-bold font-dm text-black">₹{totalCgst.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
            <p className="text-[11px] text-black/50">9% for Intra-State Tamil Nadu Orders</p>
          </div>

          <div className="p-5 rounded-2xl bg-[#FAF9F5] border border-black/5 space-y-2">
            <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider block font-mono">SGST (State Tax 9%)</span>
            <p className="text-2xl font-bold font-dm text-black">₹{totalSgst.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
            <p className="text-[11px] text-black/50">9% for Intra-State Tamil Nadu Orders</p>
          </div>

          <div className="p-5 rounded-2xl bg-[#FAF9F5] border border-black/5 space-y-2">
            <span className="text-xs font-semibold text-blue-800 uppercase tracking-wider block font-mono">IGST (Integrated Tax 18%)</span>
            <p className="text-2xl font-bold font-dm text-black">₹{totalIgst.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
            <p className="text-[11px] text-black/50">18% for Inter-State Out-of-State Orders</p>
          </div>
        </div>
      </div>

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-8 rounded-3xl border border-black/5 shadow-xs flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-950 text-emerald-400 flex items-center justify-center">
              <Building2 className="w-6 h-6" />
            </div>
            <h3 className="text-2xl font-dm font-bold text-black tracking-tight">B2B Customers & GST Reports</h3>
            <p className="text-sm text-black/60 leading-relaxed">
              View registered business customers with valid GSTIN numbers, examine tax invoices, and download complete B2B spreadsheets in Excel format.
            </p>
          </div>
          <button
            onClick={() => setLocation("/kacc/b2b-gst")}
            className="w-full py-3.5 rounded-xl bg-black text-white font-medium text-sm hover:bg-black/85 transition-colors flex items-center justify-center gap-2 group"
          >
            <span>Open B2B GST Data Page</span>
            <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </button>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-black/5 shadow-xs flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-purple-950 text-purple-300 flex items-center justify-center">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-2xl font-dm font-bold text-black tracking-tight">B2C Retail & Non-GST Reports</h3>
            <p className="text-sm text-black/60 leading-relaxed">
              Examine retail consumer orders without GST numbers, track state-wise consumer sales, and download complete B2C spreadsheets in Excel format.
            </p>
          </div>
          <button
            onClick={() => setLocation("/kacc/b2c-nongst")}
            className="w-full py-3.5 rounded-xl bg-black text-white font-medium text-sm hover:bg-black/85 transition-colors flex items-center justify-center gap-2 group"
          >
            <span>Open B2C Retail Data Page</span>
            <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </button>
        </div>
      </div>

      {/* Recent Key Account Transactions Table */}
      <div className="bg-white rounded-3xl border border-black/5 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-black/5 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-dm font-bold text-black tracking-tight">Recent Key Account Invoices</h3>
            <p className="text-xs text-black/50">Categorized by B2B (with GSTIN) and B2C (Retail)</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-inter">
            <thead className="bg-[#FAF9F5] border-b border-black/5 text-black/50 uppercase tracking-wider font-mono">
              <tr>
                <th className="py-3.5 px-6">Order ID</th>
                <th className="py-3.5 px-6">Customer / Email</th>
                <th className="py-3.5 px-6">Category</th>
                <th className="py-3.5 px-6">GSTIN Number</th>
                <th className="py-3.5 px-6 text-right">Taxable Value</th>
                <th className="py-3.5 px-6 text-right">CGST / SGST</th>
                <th className="py-3.5 px-6 text-right">IGST</th>
                <th className="py-3.5 px-6 text-right">Total Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {processedOrders.slice(0, 10).map((o) => (
                <tr key={o.id} className="hover:bg-black/2 transition-colors">
                  <td className="py-4 px-6 font-mono font-medium text-black">#{String(o.id).slice(0, 8)}</td>
                  <td className="py-4 px-6 font-medium text-black">
                    {o.customerName || o.customerEmail || "Customer"}
                  </td>
                  <td className="py-4 px-6">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold font-mono uppercase ${
                      o.isB2B ? "bg-blue-50 text-blue-800 border border-blue-200" : "bg-purple-50 text-purple-800 border border-purple-200"
                    }`}>
                      {o.category}
                    </span>
                  </td>
                  <td className="py-4 px-6 font-mono font-semibold text-black/80">
                    {o.isB2B ? o.gstNo : <span className="text-black/30 font-normal">N/A (Retail)</span>}
                  </td>
                  <td className="py-4 px-6 text-right font-mono text-black/70">
                    ₹{o.taxableValue.toFixed(2)}
                  </td>
                  <td className="py-4 px-6 text-right font-mono text-black/70">
                    {o.cgst > 0 ? (
                      <span>₹{(o.cgst + o.sgst).toFixed(2)}</span>
                    ) : (
                      <span className="text-black/30">₹0.00</span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-right font-mono text-black/70">
                    {o.igst > 0 ? (
                      <span>₹{o.igst.toFixed(2)}</span>
                    ) : (
                      <span className="text-black/30">₹0.00</span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-right font-mono font-bold text-black">
                    ₹{o.calculatedAmount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
