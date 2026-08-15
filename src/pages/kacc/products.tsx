import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package, DollarSign, TrendingUp, Calculator, Save, Download, RefreshCw, Search, Filter, AlertCircle, CheckCircle2, ChevronRight, HelpCircle, Layers, ArrowUpRight
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

interface ProductMarginData {
  id: string;
  name: string;
  slug: string;
  mrp: number;
  price: number; // default selling price
  sellingPrice: number;
  actualCost: number; // Manufacturing / Cost Price
  overhead: number; // Packaging & Shipping per bottle
  gstRate: number; // 5%, 12%, 18%
  stock: number;
  category: string;
  image: string;
}

const LOCAL_STORAGE_KEY = "kacc_product_margins_v1";

export default function KaccProducts() {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductMarginData[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [simulatingProduct, setSimulatingProduct] = useState<ProductMarginData | null>(null);
  const [simQuantity, setSimQuantity] = useState<number>(500);
  const { toast } = useToast();

  useEffect(() => {
    fetchProductsAndStock();
  }, []);

  async function fetchProductsAndStock() {
    setLoading(true);
    try {
      // 1. Fetch products
      const { data: rawProducts, error: prodErr } = await (supabase.from("products") as any)
        .select("id, name, slug, mrp, price, category, status, images")
        .neq("status", "archived")
        .order("name", { ascending: true });

      if (prodErr) throw prodErr;

      // 2. Fetch inventory stock
      const { data: rawInventory } = await (supabase.from("inventory") as any)
        .select("product_id, total_stock");

      const stockMap: Record<string, number> = {};
      if (rawInventory) {
        rawInventory.forEach((inv: any) => {
          stockMap[inv.product_id] = Number(inv.total_stock || 0);
        });
      }

      // 3. Retrieve local saved margins override
      let savedOverrides: Record<string, { sellingPrice?: number; actualCost?: number; overhead?: number; gstRate?: number }> = {};
      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) savedOverrides = JSON.parse(stored);
      } catch (e) {
        console.error("Error reading saved product margins:", e);
      }

      const mapped: ProductMarginData[] = (rawProducts || []).map((p: any) => {
        const mrp = Number(p.mrp || 0);
        const defaultPrice = Number(p.price || 0);
        const override = savedOverrides[p.id] || {};

        // Default actual cost is ~30% of MRP if not previously entered
        const defaultActualCost = override.actualCost !== undefined ? override.actualCost : Math.round(mrp * 0.3);
        const defaultOverhead = override.overhead !== undefined ? override.overhead : 15;
        const defaultSellingPrice = override.sellingPrice !== undefined ? override.sellingPrice : defaultPrice;
        // GST Rate fixed at 18% as requested
        const fixedGstRate = 18;

        const imgUrl = Array.isArray(p.images) && p.images[0]?.url ? p.images[0].url : "";

        return {
          id: p.id,
          name: p.name || "Product",
          slug: p.slug || "",
          mrp,
          price: defaultPrice,
          sellingPrice: defaultSellingPrice,
          actualCost: defaultActualCost,
          overhead: defaultOverhead,
          gstRate: fixedGstRate,
          stock: stockMap[p.id] || 0,
          category: p.category || "General",
          image: imgUrl,
        };
      });

      setProducts(mapped);
    } catch (err: any) {
      console.error("Failed to load products for KACC:", err);
      toast({
        title: "Load Failed",
        description: err.message || "Failed to fetch products from server.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  // Update product values locally & persist to localStorage
  const handleValueChange = (id: string, field: keyof ProductMarginData, value: number) => {
    setProducts((prev) => {
      const updated = prev.map((p) => (p.id === id ? { ...p, [field]: value } : p));
      
      // Persist all custom pricing & costs to LocalStorage
      const overrides: Record<string, any> = {};
      updated.forEach((item) => {
        overrides[item.id] = {
          sellingPrice: item.sellingPrice,
          actualCost: item.actualCost,
          overhead: item.overhead,
          gstRate: 18,
        };
      });
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(overrides));
      return updated;
    });
  };

  // Sync Selling Price to Supabase DB (Optional per item)
  const syncPriceToSupabase = async (product: ProductMarginData) => {
    setSavingId(product.id);
    try {
      const { error } = await (supabase.from("products") as any)
        .update({ price: product.sellingPrice })
        .eq("id", product.id);

      if (error) throw error;
      toast({
        title: "Price Synced!",
        description: `Selling price for "${product.name}" updated in database to ₹${product.sellingPrice}.`,
      });
    } catch (e: any) {
      toast({
        title: "Sync Failed",
        description: e.message || "Could not update price in database.",
        variant: "destructive",
      });
    } finally {
      setSavingId(null);
    }
  };

  // Export financial margin report to CSV
  const handleExportCSV = () => {
    if (products.length === 0) return;
    const headers = [
      "Product ID",
      "Product Name",
      "Category",
      "MRP (INR)",
      "Selling Price (INR)",
      "Actual Cost / COGS (INR)",
      "Overhead Cost (INR)",
      "Total Cost per Unit (INR)",
      "GST Rate (%)",
      "GST Amount (INR)",
      "Net Taxable Revenue (INR)",
      "Profit Margin per Bottle (INR)",
      "Margin Percentage (%)",
      "Current Stock",
      "Est. Total Potential Profit (INR)"
    ];

    const rows = products.map((p) => {
      const totalCost = p.actualCost + p.overhead;
      const netRevenue = p.sellingPrice / (1 + 18 / 100);
      const gstAmount = p.sellingPrice - netRevenue;
      const profitPerBottle = p.sellingPrice - totalCost;
      const marginPct = p.sellingPrice > 0 ? ((profitPerBottle / p.sellingPrice) * 100).toFixed(2) : "0";
      const totalPotentialProfit = (profitPerBottle * p.stock).toFixed(2);

      return [
        `"${p.id}"`,
        `"${p.name.replace(/"/g, '""')}"`,
        `"${p.category}"`,
        p.mrp,
        p.sellingPrice,
        p.actualCost,
        p.overhead,
        totalCost,
        "18%",
        gstAmount.toFixed(2),
        netRevenue.toFixed(2),
        profitPerBottle.toFixed(2),
        `${marginPct}%`,
        p.stock,
        totalPotentialProfit
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `kacc_product_margins_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({ title: "CSV Downloaded", description: "Product margin report saved to downloads." });
  };

  // Filtered products list
  const filtered = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase());
    const matchesCat = categoryFilter === "all" || p.category.toLowerCase() === categoryFilter.toLowerCase();
    return matchesSearch && matchesCat;
  });

  // Calculate Overall Financial Overview
  const totalProductsCount = products.length;
  let totalCatalogStock = 0;
  let totalPotentialProfitSum = 0;
  let totalMarginPctSum = 0;

  products.forEach((p) => {
    const totalCost = p.actualCost + p.overhead;
    const profitPerBottle = p.sellingPrice - totalCost;
    const marginPct = p.sellingPrice > 0 ? (profitPerBottle / p.sellingPrice) * 100 : 0;
    
    totalCatalogStock += p.stock;
    totalPotentialProfitSum += profitPerBottle * p.stock;
    totalMarginPctSum += marginPct;
  });

  const avgMarginPct = totalProductsCount > 0 ? (totalMarginPctSum / totalProductsCount).toFixed(1) : "0";

  const categories = Array.from(new Set(products.map((p) => p.category)));

  return (
    <div className="space-y-6 font-sans">
      {/* Header Banner */}
      <div className="bg-[#0F2318] text-white p-6 sm:p-8 rounded-3xl shadow-xl border border-emerald-900/40 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-mono font-bold uppercase">
                Product Costing & Margin Matrix
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight">
              Product Margins & Profitability
            </h1>
            <p className="text-xs sm:text-sm text-emerald-100/70 mt-1 max-w-xl">
              Automatic sync with product catalog. Fixed 18% GST slab. Enter custom selling prices, manufacturing costs, and packaging overheads.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={fetchProductsAndStock}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-all flex items-center gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
              Reload Catalog
            </button>

            <button
              onClick={handleExportCSV}
              disabled={products.length === 0}
              className="px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 flex items-center gap-2"
            >
              <Download className="w-3.5 h-3.5" />
              Export Margin Excel
            </button>
          </div>
        </div>
      </div>

      {/* Financial KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-white rounded-2xl border border-black/5 p-5 shadow-xs"
        >
          <div className="flex items-center justify-between text-black/50 text-xs font-medium mb-2">
            <span>Total Catalog Products</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-black">{totalProductsCount} Items</p>
          <p className="text-[11px] text-black/40 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Synced from store database
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="bg-white rounded-2xl border border-black/5 p-5 shadow-xs"
        >
          <div className="flex items-center justify-between text-black/50 text-xs font-medium mb-2">
            <span>Avg Catalog Margin</span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center font-bold">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-emerald-600">{avgMarginPct}%</p>
          <p className="text-[11px] text-black/40 mt-1">Average profit margin per unit</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="bg-white rounded-2xl border border-black/5 p-5 shadow-xs"
        >
          <div className="flex items-center justify-between text-black/50 text-xs font-medium mb-2">
            <span>Total Inventory Units</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-black">{totalCatalogStock.toLocaleString()} units</p>
          <p className="text-[11px] text-black/40 mt-1">In stock across all products</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="bg-white rounded-2xl border border-black/5 p-5 shadow-xs"
        >
          <div className="flex items-center justify-between text-black/50 text-xs font-medium mb-2">
            <span>Est. Potential Stock Profit</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-emerald-700">₹{Math.round(totalPotentialProfitSum).toLocaleString("en-IN")}</p>
          <p className="text-[11px] text-black/40 mt-1">Based on active inventory & cost</p>
        </motion.div>
      </div>

      {/* Controls Bar (Search & Redesigned Category Filter Pills) */}
      <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative w-72">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-black/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product by name..."
              className="w-full h-10 pl-10 pr-4 text-xs bg-[#fafaf8] border border-black/10 rounded-xl outline-none focus:border-emerald-600 transition-all placeholder:text-black/30"
            />
          </div>

          {/* Redesigned Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            <button
              onClick={() => setCategoryFilter("all")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                categoryFilter === "all"
                  ? "bg-[#0F2318] text-white shadow-xs"
                  : "bg-[#fafaf8] text-black/60 hover:bg-black/5 border border-black/5"
              }`}
            >
              All Categories
            </button>
            {categories.map((cat) => {
              const isSelected = categoryFilter.toLowerCase() === cat.toLowerCase();
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all ${
                    isSelected
                      ? "bg-[#0F2318] text-white shadow-xs"
                      : "bg-[#fafaf8] text-black/60 hover:bg-black/5 border border-black/5"
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        <div className="text-xs text-black/50 font-medium shrink-0">
          Showing <span className="font-bold text-black">{filtered.length}</span> of {products.length} products
        </div>
      </div>

      {/* Main Products Margins Table */}
      <div className="bg-white rounded-2xl border border-black/5 shadow-xs overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-7 h-7 border-2 border-emerald-600/20 border-t-emerald-600 rounded-full animate-spin" />
            <p className="text-xs text-black/40">Loading catalog product pricing...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Package className="w-10 h-10 text-black/20 mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-sm font-semibold text-black/60">No products found matching criteria.</p>
            {search && (
              <button onClick={() => setSearch("")} className="mt-2 text-xs text-emerald-600 hover:underline font-medium">
                Clear filter
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#FAF9F5] border-b border-black/5 text-[11px] font-bold text-black/50 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Product Details</th>
                  <th className="py-3.5 px-3">MRP (₹)</th>
                  <th className="py-3.5 px-3">Selling Price (₹)</th>
                  <th className="py-3.5 px-3">Actual Cost / COGS (₹)</th>
                  <th className="py-3.5 px-3">Overhead / Pkg (₹)</th>
                  <th className="py-3.5 px-3">GST Rate</th>
                  <th className="py-3.5 px-3">Net Rev (excl GST)</th>
                  <th className="py-3.5 px-3">Margin / Unit (₹)</th>
                  <th className="py-3.5 px-3 text-center">Margin %</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 text-xs font-sans">
                {filtered.map((product) => {
                  const totalCostPerUnit = product.actualCost + product.overhead;
                  const netRevenueExclGst = product.sellingPrice / (1 + 18 / 100);
                  const profitPerBottle = product.sellingPrice - totalCostPerUnit;
                  const marginPct = product.sellingPrice > 0 ? (profitPerBottle / product.sellingPrice) * 100 : 0;

                  // Determine Tier Badge
                  let badgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
                  let badgeLabel = "High Margin";
                  if (marginPct < 0) {
                    badgeClass = "bg-rose-50 text-rose-700 border-rose-200";
                    badgeLabel = "Loss";
                  } else if (marginPct < 25) {
                    badgeClass = "bg-amber-50 text-amber-700 border-amber-200";
                    badgeLabel = "Low Margin";
                  } else if (marginPct < 50) {
                    badgeClass = "bg-sky-50 text-sky-700 border-sky-200";
                    badgeLabel = "Moderate";
                  }

                  return (
                    <tr key={product.id} className="hover:bg-[#FAF9F5]/60 transition-colors">
                      {/* Product Name & Category */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={product.name}
                              className="w-10 h-10 rounded-xl object-cover border border-black/10 shrink-0 bg-muted"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200/60 flex items-center justify-center text-emerald-800 font-bold shrink-0 text-xs">
                              {product.name.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-bold text-black text-xs truncate max-w-[200px]">{product.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] bg-black/5 text-black/60 px-2 py-0.5 rounded font-mono">
                                {product.category}
                              </span>
                              <span className="text-[10px] text-black/40">Stock: {product.stock}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* MRP */}
                      <td className="py-3.5 px-3 font-semibold text-black/70">
                        ₹{product.mrp.toLocaleString("en-IN")}
                      </td>

                      {/* Redesigned Custom Selling Price Input (No Spin Arrows) */}
                      <td className="py-3.5 px-3">
                        <div className="relative w-28 group/inp">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-700 font-bold text-xs">₹</span>
                          <input
                            type="number"
                            min="0"
                            value={product.sellingPrice || ""}
                            onChange={(e) => handleValueChange(product.id, "sellingPrice", parseFloat(e.target.value) || 0)}
                            className="w-full h-9 pl-7 pr-2.5 rounded-xl border border-black/10 bg-[#fafaf8] text-xs font-bold text-black focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/10 outline-none transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                      </td>

                      {/* Redesigned Custom Actual Cost / COGS Input (No Spin Arrows) */}
                      <td className="py-3.5 px-3">
                        <div className="relative w-28 group/inp">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-amber-700 font-bold text-xs">₹</span>
                          <input
                            type="number"
                            min="0"
                            value={product.actualCost || ""}
                            onChange={(e) => handleValueChange(product.id, "actualCost", parseFloat(e.target.value) || 0)}
                            className="w-full h-9 pl-7 pr-2.5 rounded-xl border border-amber-200/80 bg-amber-50/40 text-xs font-bold text-amber-950 focus:bg-white focus:border-amber-600 focus:ring-2 focus:ring-amber-500/10 outline-none transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            title="Manufacturing / Raw material cost per unit"
                          />
                        </div>
                      </td>

                      {/* Redesigned Custom Overhead / Pkg Input (No Spin Arrows) */}
                      <td className="py-3.5 px-3">
                        <div className="relative w-24 group/inp">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-purple-700 font-bold text-xs">₹</span>
                          <input
                            type="number"
                            min="0"
                            value={product.overhead || ""}
                            onChange={(e) => handleValueChange(product.id, "overhead", parseFloat(e.target.value) || 0)}
                            className="w-full h-9 pl-7 pr-2.5 rounded-xl border border-purple-200/80 bg-purple-50/30 text-xs font-bold text-purple-950 focus:bg-white focus:border-purple-600 focus:ring-2 focus:ring-purple-500/10 outline-none transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            title="Packaging, label, and shipping overhead"
                          />
                        </div>
                      </td>

                      {/* Fixed 18% GST Badge (No Dropdown Needed) */}
                      <td className="py-3.5 px-3">
                        <span className="px-2.5 py-1 rounded-xl text-xs font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs inline-flex items-center gap-1">
                          18% GST
                        </span>
                      </td>

                      {/* Net Revenue excl GST */}
                      <td className="py-3.5 px-3 font-mono text-black/60">
                        ₹{netRevenueExclGst.toFixed(2)}
                      </td>

                      {/* Profit Margin / Bottle */}
                      <td className="py-3.5 px-3">
                        <span className={`font-bold ${profitPerBottle >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                          ₹{profitPerBottle.toFixed(2)}
                        </span>
                      </td>

                      {/* Margin % Badge */}
                      <td className="py-3.5 px-3 text-center">
                        <div className="inline-flex flex-col items-center">
                          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badgeClass}`}>
                            {marginPct.toFixed(1)}%
                          </span>
                          <span className="text-[9px] text-black/40 font-medium mt-0.5">{badgeLabel}</span>
                        </div>
                      </td>

                      {/* Action buttons */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSimulatingProduct(product)}
                            className="p-1.5 rounded-lg border border-black/10 bg-white hover:bg-emerald-50 text-emerald-800 transition-colors"
                            title="Simulate bulk batch profits"
                          >
                            <Calculator className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            disabled={savingId === product.id}
                            onClick={() => syncPriceToSupabase(product)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-800 text-white text-[11px] font-medium hover:bg-emerald-900 transition-colors shadow-xs flex items-center gap-1"
                            title="Sync updated selling price to main database"
                          >
                            {savingId === product.id ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <Save className="w-3 h-3" />
                            )}
                            <span>Sync DB</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Batch Profit Simulator Modal */}
      <AnimatePresence>
        {simulatingProduct && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSimulatingProduct(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[540px] bg-white rounded-3xl shadow-2xl z-50 p-6 border border-black/10 font-sans"
            >
              <div className="flex items-center justify-between border-b border-black/10 pb-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                    <Calculator className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-lg text-black">Batch Profit Calculator</h3>
                    <p className="text-xs text-black/50">{simulatingProduct.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSimulatingProduct(null)}
                  className="p-1.5 rounded-xl text-black/40 hover:text-black hover:bg-black/5"
                >
                  ✕
                </button>
              </div>

              {/* Inputs */}
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block font-bold text-black/70 mb-1.5">Batch Sales Quantity (Units / Bottles)</label>
                  <div className="flex items-center gap-2">
                    {[100, 500, 1000, 5000].map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        onClick={() => setSimQuantity(qty)}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                          simQuantity === qty
                            ? "bg-emerald-800 text-white border-emerald-800"
                            : "bg-[#fafaf8] border-black/10 text-black/70 hover:bg-black/5"
                        }`}
                      >
                        {qty.toLocaleString()} units
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min="1"
                    value={simQuantity}
                    onChange={(e) => setSimQuantity(parseInt(e.target.value) || 1)}
                    className="w-full h-10 px-3 mt-2 rounded-xl border border-black/15 bg-[#fafaf8] text-sm font-bold text-black outline-none focus:border-emerald-600"
                  />
                </div>

                {/* Calculation Breakdown */}
                {(() => {
                  const totalCostPerUnit = simulatingProduct.actualCost + simulatingProduct.overhead;
                  const grossBatchRevenue = simulatingProduct.sellingPrice * simQuantity;
                  const netBatchRevenueExclGst = (simulatingProduct.sellingPrice / (1 + simulatingProduct.gstRate / 100)) * simQuantity;
                  const totalGstLiability = grossBatchRevenue - netBatchRevenueExclGst;
                  const totalBatchCost = totalCostPerUnit * simQuantity;
                  const totalNetProfit = grossBatchRevenue - totalBatchCost;
                  const batchMarginPct = grossBatchRevenue > 0 ? (totalNetProfit / grossBatchRevenue) * 100 : 0;

                  return (
                    <div className="bg-[#FAF9F5] p-4.5 rounded-2xl border border-black/10 space-y-3">
                      <div className="flex justify-between items-center py-1 border-b border-black/5">
                        <span className="text-black/60 font-medium">Gross Batch Revenue</span>
                        <span className="font-bold text-black">₹{grossBatchRevenue.toLocaleString("en-IN")}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-black/5">
                        <span className="text-black/60 font-medium">GST Liability ({simulatingProduct.gstRate}%)</span>
                        <span className="font-mono text-amber-700 font-semibold">₹{totalGstLiability.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-black/5">
                        <span className="text-black/60 font-medium">Total Batch Production & Pkg Cost</span>
                        <span className="font-mono text-black/70">₹{totalBatchCost.toLocaleString("en-IN")}</span>
                      </div>
                      <div className="flex justify-between items-center pt-2 text-sm">
                        <span className="font-bold text-black">Net Batch Profit</span>
                        <span className="font-black text-emerald-700 text-lg">₹{Math.round(totalNetProfit).toLocaleString("en-IN")}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-black/50 font-medium">Net Profit Margin Rate</span>
                        <span className="font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                          {batchMarginPct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSimulatingProduct(null)}
                  className="px-5 py-2.5 rounded-xl bg-black/5 hover:bg-black/10 text-black text-xs font-semibold transition-colors"
                >
                  Close Calculator
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
