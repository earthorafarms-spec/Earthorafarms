import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, Leaf, Search, Tag, Percent, Calendar, Users, Copy, Check, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

interface Coupon {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minOrder: number;
  maxUses: number | null;
  usedCount: number;
  expiryDate: string | null;
  status: "Active" | "Inactive";
  description: string;
}



import { useEscapeKey } from "@/hooks/useEscapeKey";

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  useEscapeKey(() => { setShowForm(false); setEditingId(null); }, showForm);

  const [form, setForm] = useState({
    code: "", type: "percentage" as "percentage" | "fixed", value: "", minOrder: "", maxUses: "", expiryDate: "", description: "",
  });

  const fetchCoupons = async () => {
    try {

      const { data: rawData, error } = await supabase
        .from("coupon_details")
        .select("*")
        .order("coupon_created_at", { ascending: false });

      if (error) throw error;

      const data = rawData as any[];
      const mapped = data.map((c: any) => ({
        id: String(c.id),
        code: c.coupon_code,
        type: c.coupon_discount_type as "percentage" | "fixed",
        value: Number(c.coupon_discount_value),
        minOrder: Number(c.coupon_min_order),
        maxUses: c.coupon_max_uses,
        usedCount: c.coupon_used_count || 0,
        expiryDate: c.coupon_expiry_date,
        status: (c.coupon_status.charAt(0).toUpperCase() + c.coupon_status.slice(1)) as "Active" | "Inactive",
        description: c.coupon_description || "",
      }));

      setCoupons(mapped);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Fetch failed", description: err.message || "Failed to load coupons.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoupons();
  }, []);

  const openForm = () => {
    setEditingId(null);
    setForm({ code: "", type: "percentage", value: "", minOrder: "", maxUses: "", expiryDate: "", description: "" });
    setShowForm(true);
  };

  const openEdit = (coupon: Coupon) => {
    setEditingId(coupon.id);
    setForm({
      code: coupon.code,
      type: coupon.type,
      value: String(coupon.value),
      minOrder: String(coupon.minOrder),
      maxUses: coupon.maxUses !== null ? String(coupon.maxUses) : "",
      expiryDate: coupon.expiryDate || "",
      description: coupon.description !== "-" ? coupon.description : "",
    });
    setShowForm(true);
  };

  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    toast({ title: "Copied!", description: `Coupon code "${code}" copied to clipboard.` });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from("coupon_details").delete().eq("id", parseInt(id));
      if (error) throw error;
      toast({ title: "Coupon deleted", description: "The coupon has been removed." });
      fetchCoupons();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const handleToggleStatus = async (id: string) => {
    const coupon = coupons.find(c => c.id === id);
    if (!coupon) return;
    const nextStatus = coupon.status === "Active" ? "inactive" : "active";

    try {
      const { error } = await (supabase.from("coupon_details") as any)
        .update({ coupon_status: nextStatus })
        .eq("id", parseInt(id));
      if (error) throw error;
      toast({ title: "Status updated", description: "Coupon status has been updated in database." });
      fetchCoupons();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  };

  const handleSubmit = async () => {
    if (!form.code || !form.value) {
      toast({ title: "Missing fields", description: "Coupon code and value are required." });
      return;
    }

    try {
      const val = parseFloat(form.value) || 0;
      const codeUpper = form.code.trim().toUpperCase();
      const formattedDate = form.expiryDate.trim() || null;

      if (editingId) {
        // Update existing coupon
        const updatePayload: Record<string, any> = {
          coupon_discount_type: form.type,
          coupon_discount_amount: val,
          coupon_discount_value: val,
          coupon_min_order: parseFloat(form.minOrder) || 0,
          coupon_description: form.description || "-",
          coupon_expiry_date: formattedDate,
        };
        if (form.maxUses) updatePayload.coupon_max_uses = parseInt(form.maxUses);

        const { error } = await (supabase.from("coupon_details") as any)
          .update(updatePayload)
          .eq("id", parseInt(editingId));

        if (error) throw error;
        toast({ title: "Coupon updated", description: `Coupon "${codeUpper}" has been updated.` });
      } else {
        // Create new coupon
        const payload: Record<string, any> = {
          coupon_code: codeUpper,
          coupon_discount_type: form.type,
          coupon_discount_amount: val,
          coupon_discount_value: val,
          coupon_min_order: parseFloat(form.minOrder) || 0,
          coupon_status: "active",
          coupon_description: form.description || "-",
        };
        if (form.maxUses) payload.coupon_max_uses = parseInt(form.maxUses);
        if (formattedDate) payload.coupon_expiry_date = formattedDate;

        const { error: errDetails } = await (supabase.from("coupon_details") as any)
          .insert(payload);

        if (errDetails) {
          const { error: errFallback } = await (supabase.from("coupon_details") as any)
            .insert({
              coupon_code: codeUpper,
              coupon_discount_type: form.type,
              coupon_discount_amount: val,
              coupon_discount_value: val,
              coupon_description: form.description || "-",
            });
          if (errFallback) throw errDetails || errFallback;
        }

        toast({ title: "Coupon created", description: `Coupon "${codeUpper}" is now active.` });
      }

      fetchCoupons();
      setShowForm(false);
      setEditingId(null);
    } catch (err: any) {
      console.error("Coupon save error:", err);
      toast({ title: editingId ? "Update failed" : "Creation failed", description: err.message || "Invalid coupon parameters.", variant: "destructive" });
    }
  };

  return (
    <>
      <motion.div
        key="coupons"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/30" strokeWidth={1.5} />
              <input
                type="text"
                placeholder="Search coupons..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 pl-10 pr-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all w-60 placeholder:text-foreground/30"
              />
            </div>
            <span className="text-xs text-foreground/30 ml-2">
              {searchQuery.trim()
                ? `${coupons.filter(c => c.code.toLowerCase().includes(searchQuery.toLowerCase()) || c.description?.toLowerCase().includes(searchQuery.toLowerCase())).length} of ${coupons.length} coupons`
                : `${coupons.length} coupons`}
            </span>
          </div>
          <Button className="gap-1.5 h-11 px-5 shadow-md" onClick={openForm}>
            <Plus className="w-4 h-4" strokeWidth={2} />
            Create Coupon
          </Button>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-20 text-foreground/40 text-xs">
              Loading coupons...
            </div>
          ) : coupons.length === 0 ? (
            <div className="text-center py-20 bg-white border border-border/40 rounded-2xl text-foreground/40 font-medium">
              No coupons yet — create your first one.
            </div>
          ) : (
            coupons
              .filter(c => !searchQuery.trim() ||
                c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (c.description || "").toLowerCase().includes(searchQuery.toLowerCase())
              )
              .map((coupon, i) => (
              <motion.div
                key={coupon.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.05 }}
                className="bg-white rounded-2xl border border-border/40 p-5 hover:border-primary/20 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.02)] transition-all duration-300"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${coupon.status === "Active" ? "bg-primary/10" : "bg-border/30"}`}>
                      <Tag className={`w-5 h-5 ${coupon.status === "Active" ? "text-primary" : "text-foreground/30"}`} strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className={`font-mono text-sm font-bold tracking-wider ${coupon.status === "Active" ? "text-foreground" : "text-foreground/40"}`}>
                          {coupon.code}
                        </span>
                        <button
                          onClick={() => handleCopy(coupon.code, coupon.id)}
                          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-foreground/30 hover:text-primary"
                          title="Copy code"
                        >
                          {copiedId === coupon.id ? <Check className="w-3.5 h-3.5 text-green-600" strokeWidth={2} /> : <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />}
                        </button>
                      </div>
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1">
                        <span className="text-xs text-foreground/50">{coupon.description}</span>
                        {coupon.minOrder > 0 && (
                          <>
                            <span className="text-foreground/20">•</span>
                            <span className="text-xs text-foreground/40">Min: {coupon.minOrder}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        {coupon.type === "percentage" ? (
                          <Percent className="w-3 h-3 text-foreground/40" strokeWidth={1.5} />
                        ) : (
                          <span className="text-xs text-foreground/40">₹</span>
                        )}
                        <span className="text-base font-bold text-foreground">
                          {coupon.type === "percentage" ? `${coupon.value}%` : coupon.value}
                        </span>
                      </div>
                      <p className="text-[10px] text-foreground/40 mt-0.5">{coupon.type === "percentage" ? "Off" : "Flat discount"}</p>
                    </div>

                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-foreground/30" strokeWidth={1.5} />
                        <span className="text-xs text-foreground/60">{coupon.expiryDate}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Users className="w-3 h-3 text-foreground/30" strokeWidth={1.5} />
                        <span className="text-[10px] text-foreground/40">{coupon.usedCount}/{coupon.maxUses} used</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleStatus(coupon.id)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                          coupon.status === "Active"
                            ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                            : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                        }`}
                      >
                        {coupon.status}
                      </button>
                      <button
                        onClick={() => openEdit(coupon)}
                        className="p-2 rounded-lg text-foreground/30 hover:text-primary hover:bg-primary/5 transition-colors"
                        title="Edit coupon"
                      >
                        <Pencil className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                      <button
                        onClick={() => handleDelete(coupon.id)}
                        className="p-2 rounded-lg text-foreground/30 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Delete coupon"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={() => setShowForm(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-4 md:inset-x-1/4 md:inset-y-20 z-50 bg-background md:rounded-2xl overflow-hidden flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 md:px-8 h-16 border-b border-border/30 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    {editingId ? <Pencil className="w-4 h-4 text-primary" strokeWidth={1.5} /> : <Tag className="w-4 h-4 text-primary" strokeWidth={1.5} />}
                  </div>
                  <h2 className="text-sm font-serif font-bold text-foreground">{editingId ? "Edit Coupon" : "Create Coupon"}</h2>
                </div>
                <button onClick={() => { setShowForm(false); setEditingId(null); }} className="p-2 rounded-full hover:bg-muted transition-colors"><X className="w-5 h-5 text-foreground/60" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 md:p-8">
                <div className="max-w-lg mx-auto space-y-5">
                  <div>
                    <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">
                      Coupon Code *{editingId && <span className="normal-case font-normal ml-1 text-foreground/40">(cannot be changed)</span>}
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={form.code}
                        onChange={(e) => !editingId && setForm({ ...form, code: e.target.value.toUpperCase() })}
                        readOnly={!!editingId}
                        placeholder="e.g. SUMMER25"
                        className={`w-full h-12 px-4 text-sm font-mono font-bold tracking-widest border border-border/40 rounded-xl outline-none transition-all placeholder:text-foreground/25 uppercase ${editingId ? "bg-muted/40 text-foreground/50 cursor-not-allowed" : "bg-white focus:border-primary/30 focus:ring-2 focus:ring-primary/5"}`}
                        maxLength={15}
                      />
                      {!editingId && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] text-foreground/25 font-mono">{form.code.length}/15</span>}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Discount Type</label>
                    <div className="flex gap-2">
                      {[
                        { value: "percentage" as const, label: "Percentage (%)", icon: Percent },
                        { value: "fixed" as const, label: "Fixed Amount (₹)", icon: Tag },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm({ ...form, type: opt.value })}
                          className={`flex-1 flex items-center justify-center gap-2 h-12 rounded-xl text-sm font-semibold border transition-all ${
                            form.type === opt.value
                              ? "bg-primary text-white border-primary shadow-sm"
                              : "bg-white text-foreground/60 border-border/40 hover:border-primary/30"
                          }`}
                        >
                          <opt.icon className="w-4 h-4" strokeWidth={1.5} />
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">
                        {form.type === "percentage" ? "Discount %" : "Discount Amount"}
                      </label>
                      <input
                        type="number"
                        value={form.value}
                        onChange={(e) => setForm({ ...form, value: e.target.value })}
                        placeholder={form.type === "percentage" ? "20" : "100"}
                        className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Min. Order Value</label>
                      <input
                        type="number"
                        value={form.minOrder}
                        onChange={(e) => setForm({ ...form, minOrder: e.target.value })}
                        placeholder="499"
                        className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Max Uses</label>
                      <input
                        type="number"
                        value={form.maxUses}
                        onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                        placeholder="100"
                        className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Expiry Date</label>
                      <input
                        type="text"
                        value={form.expiryDate}
                        onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                        placeholder="31 Dec 2026"
                        className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Description</label>
                    <input
                      type="text"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="e.g. Monsoon season sale"
                      className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-5 border-t border-border/20">
                    <Button variant="outline" onClick={() => { setShowForm(false); setEditingId(null); }} className="h-11 px-6">Cancel</Button>
                    <Button onClick={handleSubmit} className="h-11 px-8 gap-2 shadow-md">
                      {editingId ? <Pencil className="w-4 h-4" strokeWidth={1.5} /> : <Leaf className="w-4 h-4" strokeWidth={1.5} />}
                      {editingId ? "Save Changes" : "Create Coupon"}
                    </Button>
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
