import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, X, Search, Sparkles, Percent, Tag, Calendar,
  Trash2, Package, Loader2, ChevronDown, ArrowRight,
  Check, Clock, ImageIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

interface FestiveDeal {
  id: string;
  title: string;
  festivalName: string;
  description: string;
  bannerImage: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  startsAt: string;
  endsAt: string;
  status: "Active" | "Inactive";
  productIds: string[];
  productCount: number;
}

interface ProductOption {
  id: string;
  name: string;
}

const initialDeals: FestiveDeal[] = [];

const emptyForm = {
  title: "",
  festivalName: "",
  description: "",
  bannerImage: "",
  discountType: "percentage" as "percentage" | "fixed",
  discountValue: "",
  startsAt: "",
  endsAt: "",
  productIds: [] as string[],
};

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function daysBetween(a: string, b: string) {
  if (!a || !b) return 0;
  return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export default function AdminFestive() {
  const [deals, setDeals] = useState<FestiveDeal[]>(initialDeals);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productDropOpen, setProductDropOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const productDropRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (productDropRef.current && !productDropRef.current.contains(e.target as Node)) {
        setProductDropOpen(false);
      }
    }
    if (productDropOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [productDropOpen]);

  const fetchDeals = async () => {
    try {
      const { data: rawDeals, error } = await supabase
        .from("festival_details")
        .select("*, festival_deal_products(product_id)")
        .order("id", { ascending: false });

      if (error) throw error;

      const mapped = (rawDeals as any[]).map((d: any) => ({
        id: String(d.id),
        title: d.festival_title,
        festivalName: d.festival_name,
        description: d.festival_description || "",
        bannerImage: d.banner_image || "",
        discountType: d.discount_type as "percentage" | "fixed",
        discountValue: Number(d.discount_value),
        startsAt: d.festival_start_date?.slice(0, 10) ?? "",
        endsAt: d.festival_end_date?.slice(0, 10) ?? "",
        status: (d.festival_status === "active" ? "Active" : "Inactive") as "Active" | "Inactive",
        productIds: (d.festival_deal_products || []).map((p: any) => p.product_id),
        productCount: (d.festival_deal_products || []).length,
      }));
      setDeals(mapped);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Fetch failed", description: err.message || "Failed to fetch deals.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    const { data, error } = await supabase.from("products").select("id, name").neq("status", "archived").order("name");
    if (!error && data) setProducts((data as any[]).map((p: any) => ({ id: p.id, name: p.name })));
  };

  useEffect(() => {
    fetchDeals();
    fetchProducts();
  }, []);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (deal: FestiveDeal) => {
    setEditId(deal.id);
    setForm({
      title: deal.title,
      festivalName: deal.festivalName,
      description: deal.description,
      bannerImage: deal.bannerImage,
      discountType: deal.discountType,
      discountValue: String(deal.discountValue),
      startsAt: deal.startsAt,
      endsAt: deal.endsAt,
      productIds: deal.productIds,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setProductDropOpen(false);
    setProductSearch("");
  };

  const toggleProductId = (id: string) => {
    setForm((prev) => ({
      ...prev,
      productIds: prev.productIds.includes(id)
        ? prev.productIds.filter((p) => p !== id)
        : [...prev.productIds, id],
    }));
  };

  const handleSubmit = async () => {
    if (!form.title || !form.festivalName || !form.discountValue || !form.startsAt || !form.endsAt) {
      toast({ title: "Missing fields", description: "Title, festival name, discount, start and end dates are required.", variant: "destructive" });
      return;
    }
    if (new Date(form.startsAt) >= new Date(form.endsAt)) {
      toast({ title: "Invalid dates", description: "Start date must be before end date.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        festival_title: form.title,
        festival_name: form.festivalName,
        festival_description: form.description || "",
        banner_image: form.bannerImage || null,
        discount_type: form.discountType,
        discount_value: parseFloat(form.discountValue) || 0,
        festival_start_date: new Date(form.startsAt).toISOString(),
        festival_end_date: new Date(form.endsAt).toISOString(),
        festival_status: "active",
      };

      let dealId: number | null = editId ? parseInt(editId) : null;

      if (editId && dealId) {
        const { error } = await (supabase.from("festival_details") as any).update(payload).eq("id", dealId);
        if (error) throw error;
        await (supabase.from("festival_deal_products") as any).delete().eq("deal_id", dealId);
      } else {
        const { data, error } = await (supabase.from("festival_details") as any).insert(payload).select().single();
        if (error) throw error;
        dealId = (data as any).id;
      }

      if (form.productIds.length > 0 && dealId) {
        const links = form.productIds.map((pid) => ({ deal_id: dealId, product_id: pid }));
        await (supabase.from("festival_deal_products") as any).insert(links as any);
      }

      toast({ title: editId ? "Deal updated" : "Deal created", description: `"${form.title}" is now live.` });
      fetchDeals();
      closeForm();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (id: string) => {
    const deal = deals.find((d) => d.id === id);
    if (!deal) return;
    const next = deal.status === "Active" ? "inactive" : "active";
    try {
      const { error } = await (supabase.from("festival_details") as any).update({ festival_status: next }).eq("id", parseInt(id));
      if (error) throw error;
      toast({ title: "Status updated" });
      fetchDeals();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from("festival_details").delete().eq("id", parseInt(id));
      if (error) throw error;
      toast({ title: "Deal deleted" });
      fetchDeals();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const filtered = deals.filter((d) =>
    !search || d.title.toLowerCase().includes(search.toLowerCase()) ||
    d.festivalName.toLowerCase().includes(search.toLowerCase())
  );

  const filteredProducts = products.filter((p) =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  const discountLabel = form.discountType === "percentage" ? `${form.discountValue || "0"}% OFF` : `₹${form.discountValue || "0"} OFF`;
  const dealDuration = daysBetween(form.startsAt, form.endsAt);

  return (
    <>
      <motion.div
        key="festive"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="space-y-6"
      >
        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/25" strokeWidth={1.5} />
              <input
                type="text"
                placeholder="Search deals..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 pl-10 pr-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all w-60 placeholder:text-foreground/25"
              />
            </div>
            <span className="text-xs text-foreground/30">{filtered.length} deal{filtered.length !== 1 ? "s" : ""}</span>
          </div>
          <button
            onClick={openCreate}
            className="group relative inline-flex items-center gap-2.5 h-11 px-6 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/25 active:scale-[0.97] transition-all duration-300"
          >
            <Plus className="w-4 h-4" strokeWidth={2} />
            New Deal
            <span className="w-6 h-6 rounded-lg bg-white/15 flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
            </span>
          </button>
        </div>

        {/* ── Deal list ── */}
        {loading ? (
          <div className="flex items-center justify-center h-48 text-foreground/30">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-foreground/30">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-amber-400" strokeWidth={1} />
            </div>
            <p className="text-sm font-medium text-foreground/40">No festive deals yet</p>
            <button onClick={openCreate} className="text-xs text-primary font-medium hover:underline underline-offset-2">
              Create your first deal
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((deal, i) => {
              const isLive = deal.status === "Active" && new Date(deal.startsAt) <= new Date() && new Date(deal.endsAt) >= new Date();
              const isExpired = new Date(deal.endsAt) < new Date();
              return (
                <motion.div
                  key={deal.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.05 }}
                  className="group bg-white rounded-2xl border border-border/40 p-1.5 transition-all duration-300 hover:border-primary/15 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
                >
                  <div className="bg-white rounded-[calc(1rem-0.375rem)] p-4 md:p-5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                          isLive ? "bg-emerald-50" : isExpired ? "bg-gray-50" : "bg-amber-50"
                        }`}>
                          <Sparkles className={`w-5 h-5 ${
                            isLive ? "text-emerald-500" : isExpired ? "text-gray-300" : "text-amber-500"
                          }`} strokeWidth={1.5} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center flex-wrap gap-2">
                            <span className="text-sm font-semibold text-foreground truncate max-w-[220px]">
                              {deal.title}
                            </span>
                            {isLive && (
                              <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded-full border border-emerald-200">
                                LIVE
                              </span>
                            )}
                            {isExpired && deal.status === "Active" && (
                              <span className="px-2 py-0.5 text-[10px] font-bold bg-gray-100 text-gray-500 rounded-full border border-gray-200">
                                EXPIRED
                              </span>
                            )}
                          </div>
                          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1">
                            <span className="text-xs text-foreground/50 font-medium">{deal.festivalName}</span>
                            <span className="text-foreground/15">·</span>
                            <span className="text-xs text-foreground/40 flex items-center gap-1">
                              <Package className="w-3 h-3" strokeWidth={1.5} />
                              {deal.productCount} product{deal.productCount !== 1 ? "s" : ""}
                            </span>
                            {deal.description && (
                              <>
                                <span className="text-foreground/15">·</span>
                                <span className="text-xs text-foreground/35 truncate max-w-[160px]">{deal.description}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-5 shrink-0 flex-wrap">
                        <div className="text-right">
                          <div className="flex items-center gap-1">
                            {deal.discountType === "percentage" ? (
                              <Percent className="w-3 h-3 text-foreground/30" strokeWidth={1.5} />
                            ) : (
                              <span className="text-xs text-foreground/30 font-medium">₹</span>
                            )}
                            <span className="text-base font-bold text-foreground">
                              {deal.discountType === "percentage" ? `${deal.discountValue}%` : deal.discountValue}
                            </span>
                          </div>
                          <p className="text-[10px] text-foreground/35 mt-0.5">{deal.discountType === "percentage" ? "Off" : "Flat off"}</p>
                        </div>

                        <div className="text-right min-w-[90px]">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-foreground/25" strokeWidth={1.5} />
                            <span className="text-xs text-foreground/50">{formatDate(deal.startsAt)}</span>
                          </div>
                          <span className="text-[10px] text-foreground/30">→ {formatDate(deal.endsAt)}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEdit(deal)}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border text-foreground/50 border-border/50 hover:border-primary/30 hover:text-primary hover:bg-primary/5 transition-all"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggleStatus(deal.id)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                              deal.status === "Active"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                            }`}
                          >
                            {deal.status}
                          </button>
                          <button
                            onClick={() => handleDelete(deal.id)}
                            className="p-2 rounded-lg text-foreground/25 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Delete deal"
                          >
                            <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* ── Slide-in form ── */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              onClick={closeForm}
            />
            <motion.div
              initial={{ opacity: 0, x: "30%" }}
              animate={{ opacity: 1, x: "0%" }}
              exit={{ opacity: 0, x: "30%" }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-[820px] z-50 bg-[#fafaf8] shadow-2xl flex flex-col border-l border-border/20"
              onClick={(e) => e.stopPropagation()}
            >
              {/* ── Form header ── */}
              <div className="flex items-center justify-between px-8 h-16 shrink-0 bg-white border-b border-border/20">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shadow-sm">
                    <Sparkles className="w-4 h-4 text-white" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h2 className="text-sm font-serif font-bold text-foreground">
                      {editId ? "Edit Festive Deal" : "Create Festive Deal"}
                    </h2>
                    <p className="text-[11px] text-foreground/35 mt-0.5">
                      {editId ? "Update the festive promotion details" : "Set up a new seasonal promotion"}
                    </p>
                  </div>
                </div>
                <button onClick={closeForm} className="p-2 rounded-xl hover:bg-muted transition-colors">
                  <X className="w-5 h-5 text-foreground/40" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                <div className="flex flex-col lg:flex-row min-h-full">
                  {/* ── Form fields ── */}
                  <div className="flex-1 p-8 lg:p-10 space-y-7">
                    <div className="space-y-6">
                      {/* Title */}
                      <div>
                        <label className="text-[11px] font-semibold text-foreground/50 uppercase tracking-widest mb-2 block">Deal Title</label>
                        <div className="relative group">
                          <input
                            type="text"
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                            placeholder="e.g. Diwali Wellness Bonanza"
                            className="w-full h-12 px-4 text-sm bg-white border-2 border-transparent rounded-xl outline-none ring-1 ring-border/40 focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-foreground/20 group-hover:ring-border/60"
                          />
                        </div>
                      </div>

                      {/* Festival name + Discount type */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[11px] font-semibold text-foreground/50 uppercase tracking-widest mb-2 block">Festival</label>
                          <div className="relative group">
                            <input
                              type="text"
                              value={form.festivalName}
                              onChange={(e) => setForm({ ...form, festivalName: e.target.value })}
                              placeholder="e.g. Diwali, Holi"
                              className="w-full h-12 px-4 text-sm bg-white border-2 border-transparent rounded-xl outline-none ring-1 ring-border/40 focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-foreground/20 group-hover:ring-border/60"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-foreground/50 uppercase tracking-widest mb-2 block">Discount Type</label>
                          <div className="flex gap-2">
                            {(["percentage", "fixed"] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setForm({ ...form, discountType: t })}
                                className={`flex-1 h-12 rounded-xl text-sm font-semibold border-2 transition-all duration-200 ${
                                  form.discountType === t
                                    ? "bg-primary border-primary text-primary-foreground shadow-sm"
                                    : "bg-white border-transparent ring-1 ring-border/40 text-foreground/50 hover:ring-primary/30"
                                }`}
                              >
                                {t === "percentage" ? "% Off" : "₹ Fixed"}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Discount value + dates */}
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="text-[11px] font-semibold text-foreground/50 uppercase tracking-widest mb-2 block">
                            {form.discountType === "percentage" ? "Percentage" : "Amount"}
                          </label>
                          <div className="relative group">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground/20 text-sm font-medium">
                              {form.discountType === "percentage" ? "%" : "₹"}
                            </span>
                            <input
                              type="number"
                              value={form.discountValue}
                              onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                              placeholder="0"
                              className="w-full h-12 pl-8 pr-4 text-sm bg-white border-2 border-transparent rounded-xl outline-none ring-1 ring-border/40 focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-foreground/20 group-hover:ring-border/60 [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-foreground/50 uppercase tracking-widest mb-2 block">Starts</label>
                          <div className="relative group">
                            <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20" strokeWidth={1.5} />
                            <input
                              type="date"
                              value={form.startsAt}
                              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                              className="w-full h-12 pl-10 pr-4 text-sm bg-white border-2 border-transparent rounded-xl outline-none ring-1 ring-border/40 focus:ring-2 focus:ring-primary/30 transition-all [color-scheme:light] group-hover:ring-border/60"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-foreground/50 uppercase tracking-widest mb-2 block">Ends</label>
                          <div className="relative group">
                            <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20" strokeWidth={1.5} />
                            <input
                              type="date"
                              value={form.endsAt}
                              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                              className="w-full h-12 pl-10 pr-4 text-sm bg-white border-2 border-transparent rounded-xl outline-none ring-1 ring-border/40 focus:ring-2 focus:ring-primary/30 transition-all [color-scheme:light] group-hover:ring-border/60"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Description */}
                      <div>
                        <label className="text-[11px] font-semibold text-foreground/50 uppercase tracking-widest mb-2 block">Description</label>
                        <textarea
                          value={form.description}
                          onChange={(e) => setForm({ ...form, description: e.target.value })}
                          placeholder="Optional short description shown on the banner…"
                          rows={2}
                          className="w-full px-4 py-3 text-sm bg-white border-2 border-transparent rounded-xl outline-none ring-1 ring-border/40 focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-foreground/20 resize-none"
                        />
                      </div>

                      {/* Banner Image URL */}
                      <div>
                        <label className="text-[11px] font-semibold text-foreground/50 uppercase tracking-widest mb-2 block">Banner Image</label>
                        <div className="relative group">
                          <ImageIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20" strokeWidth={1.5} />
                          <input
                            type="text"
                            value={form.bannerImage}
                            onChange={(e) => setForm({ ...form, bannerImage: e.target.value })}
                            placeholder="https://..."
                            className="w-full h-12 pl-10 pr-4 text-sm bg-white border-2 border-transparent rounded-xl outline-none ring-1 ring-border/40 focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-foreground/20 group-hover:ring-border/60"
                          />
                        </div>
                      </div>

                      {/* Product multi-select */}
                      <div>
                        <label className="text-[11px] font-semibold text-foreground/50 uppercase tracking-widest mb-2 block">
                          Products ({form.productIds.length} selected)
                        </label>
                        {products.length === 0 ? (
                          <p className="text-xs text-foreground/30 py-2">No products available.</p>
                        ) : (
                          <div className="relative" ref={productDropRef}>
                            <button
                              type="button"
                              onClick={() => setProductDropOpen(!productDropOpen)}
                              className="w-full h-12 px-4 text-sm bg-white border-2 border-transparent rounded-xl outline-none ring-1 ring-border/40 hover:ring-border/60 focus:ring-2 focus:ring-primary/30 transition-all text-left flex items-center justify-between"
                            >
                              <span className={form.productIds.length === 0 ? "text-foreground/20" : "text-foreground"}>
                                {form.productIds.length === 0 ? "Select products…" : `${form.productIds.length} product${form.productIds.length !== 1 ? "s" : ""} selected`}
                              </span>
                              <ChevronDown className={`w-4 h-4 text-foreground/20 transition-transform duration-200 ${productDropOpen ? "rotate-180" : ""}`} strokeWidth={1.5} />
                            </button>
                            <AnimatePresence>
                              {productDropOpen && (
                                <motion.div
                                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                                  className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-border/30 rounded-xl shadow-xl z-10 max-h-64 overflow-hidden"
                                >
                                  <div className="p-2 border-b border-border/10">
                                    <div className="relative">
                                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/20" strokeWidth={1.5} />
                                      <input
                                        type="text"
                                        value={productSearch}
                                        onChange={(e) => setProductSearch(e.target.value)}
                                        placeholder="Search products..."
                                        className="w-full h-9 pl-9 pr-3 text-xs bg-muted/50 rounded-lg outline-none focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-foreground/20"
                                        autoFocus
                                      />
                                    </div>
                                  </div>
                                  <div className="max-h-48 overflow-y-auto p-1.5">
                                    {filteredProducts.length === 0 ? (
                                      <p className="text-xs text-foreground/30 text-center py-6">No products match</p>
                                    ) : (
                                      filteredProducts.map((p) => {
                                        const checked = form.productIds.includes(p.id);
                                        return (
                                          <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => toggleProductId(p.id)}
                                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${
                                              checked
                                                ? "bg-primary/5 text-primary font-medium"
                                                : "text-foreground/70 hover:bg-muted/50"
                                            }`}
                                          >
                                            <span className={`w-5 h-5 rounded-lg border-2 flex-shrink-0 flex items-center justify-center transition-all duration-150 ${
                                              checked
                                                ? "bg-primary border-primary"
                                                : "border-border/50"
                                            }`}>
                                              {checked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                                            </span>
                                            {p.name}
                                          </button>
                                        );
                                      })
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── Actions ── */}
                    <div className="flex items-center justify-between gap-4 pt-6 border-t border-border/10">
                      <button
                        type="button"
                        onClick={closeForm}
                        className="h-11 px-6 rounded-xl text-sm font-semibold text-foreground/50 hover:text-foreground hover:bg-muted transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className="group relative inline-flex items-center gap-2.5 h-11 px-7 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/25 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300"
                      >
                        {saving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" strokeWidth={1.5} />
                        )}
                        {saving ? "Saving…" : editId ? "Save Changes" : "Create Deal"}
                        {!saving && (
                          <span className="w-6 h-6 rounded-lg bg-white/15 flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
                            <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* ── Live Preview Panel ── */}
                  <div className="lg:w-80 bg-white border-t lg:border-t-0 lg:border-l border-border/10 p-8 lg:p-6">
                    <div className="sticky top-8 space-y-5">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[11px] font-semibold text-foreground/40 uppercase tracking-widest">Live Preview</span>
                      </div>

                      {/* Preview card */}
                      <div className="rounded-2xl overflow-hidden border border-border/20 bg-white shadow-sm">
                        <div className={`p-5 ${form.bannerImage ? "bg-cover bg-center" : "bg-gradient-to-br from-amber-500 via-amber-400 to-orange-400"}`}
                          style={form.bannerImage ? { backgroundImage: `url(${form.bannerImage})` } : undefined}
                        >
                          <div className={`${form.bannerImage ? "bg-black/40 backdrop-blur-sm" : ""} rounded-xl p-4`}>
                            <div className="text-center">
                              {form.festivalName && (
                                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mb-2 ${
                                  form.bannerImage ? "bg-white/20 text-white" : "bg-white/25 text-white"
                                }`}>
                                  {form.festivalName} Special
                                </span>
                              )}
                              <h3 className={`text-lg font-serif font-bold leading-tight mb-1 ${
                                form.bannerImage ? "text-white" : "text-white"
                              }`}>
                                {form.title || "Deal Title"}
                              </h3>
                              <div className={`text-2xl font-bold mt-2 ${
                                form.bannerImage ? "text-amber-200" : "text-white"
                              }`}>
                                {form.discountValue ? discountLabel : "20% OFF"}
                              </div>
                              {form.description && (
                                <p className={`text-xs mt-2 line-clamp-2 ${
                                  form.bannerImage ? "text-white/70" : "text-white/80"
                                }`}>
                                  {form.description}
                                </p>
                              )}
                              {dealDuration > 0 && (
                                <div className={`flex items-center justify-center gap-1 mt-3 text-[10px] ${
                                  form.bannerImage ? "text-white/60" : "text-white/70"
                                }`}>
                                  <Clock className="w-3 h-3" strokeWidth={1.5} />
                                  <span>{dealDuration} day{dealDuration !== 1 ? "s" : ""}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between py-2 border-b border-border/10">
                          <span className="text-[11px] text-foreground/40">Festival</span>
                          <span className="text-xs font-medium text-foreground/70">{form.festivalName || "—"}</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-border/10">
                          <span className="text-[11px] text-foreground/40">Discount</span>
                          <span className="text-xs font-medium text-foreground/70">{form.discountValue ? discountLabel : "—"}</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-border/10">
                          <span className="text-[11px] text-foreground/40">Duration</span>
                          <span className="text-xs font-medium text-foreground/70">
                            {form.startsAt && form.endsAt ? `${dealDuration}d` : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-[11px] text-foreground/40">Products</span>
                          <span className="text-xs font-medium text-foreground/70">{form.productIds.length} selected</span>
                        </div>
                      </div>

                      <div className="pt-2">
                        <div className="rounded-xl bg-amber-50 border border-amber-100 p-3.5">
                          <div className="flex items-start gap-2.5">
                            <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" strokeWidth={1.5} />
                            <div>
                              <p className="text-xs font-semibold text-amber-800">Festive Deal</p>
                              <p className="text-[11px] text-amber-600/70 mt-0.5">This promotion will be active from {formatDate(form.startsAt) || "start"} to {formatDate(form.endsAt) || "end"}.</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
