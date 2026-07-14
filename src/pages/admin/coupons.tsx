import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, Leaf, Search, Tag, Percent, Calendar, Users, Copy, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface Coupon {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minOrder: number;
  maxUses: number;
  usedCount: number;
  expiryDate: string;
  status: "Active" | "Inactive";
  description: string;
}

const initialCoupons: Coupon[] = [
  { id: "1", code: "WELCOME20", type: "percentage", value: 20, minOrder: 499, maxUses: 100, usedCount: 34, expiryDate: "31 Dec 2026", status: "Active", description: "First-time customer discount" },
  { id: "2", code: "FREESHIP", type: "fixed", value: 99, minOrder: 699, maxUses: 200, usedCount: 78, expiryDate: "31 Dec 2026", status: "Active", description: "Free shipping coupon" },
  { id: "3", code: "MORINGA15", type: "percentage", value: 15, minOrder: 299, maxUses: 50, usedCount: 12, expiryDate: "15 Aug 2026", status: "Active", description: "Monsoon sale" },
  { id: "4", code: "FLAT100", type: "fixed", value: 100, minOrder: 999, maxUses: 30, usedCount: 5, expiryDate: "30 Sep 2026", status: "Inactive", description: "Flat ₹100 off on bulk orders" },
];

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState(initialCoupons);
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { toast } = useToast();

  const [form, setForm] = useState({
    code: "", type: "percentage" as "percentage" | "fixed", value: "", minOrder: "", maxUses: "", expiryDate: "", description: "",
  });

  const openForm = () => {
    setForm({ code: "", type: "percentage", value: "", minOrder: "", maxUses: "", expiryDate: "", description: "" });
    setShowForm(true);
  };

  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    toast({ title: "Copied!", description: `Coupon code "${code}" copied to clipboard.` });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = (id: string) => {
    setCoupons((prev) => prev.filter((c) => c.id !== id));
    toast({ title: "Coupon deleted", description: "The coupon has been removed." });
  };

  const handleToggleStatus = (id: string) => {
    setCoupons((prev) => prev.map((c) => c.id === id ? { ...c, status: c.status === "Active" ? "Inactive" : "Active" } : c));
    toast({ title: "Status updated", description: "Coupon status has been changed." });
  };

  const handleSubmit = () => {
    if (!form.code || !form.value) {
      toast({ title: "Missing fields", description: "Coupon code and value are required." });
      return;
    }
    const newCoupon: Coupon = {
      id: String(Date.now()),
      code: form.code.toUpperCase(),
      type: form.type,
      value: parseFloat(form.value) || 0,
      minOrder: parseFloat(form.minOrder) || 0,
      maxUses: parseInt(form.maxUses) || 0,
      usedCount: 0,
      expiryDate: form.expiryDate || "No expiry",
      status: "Active",
      description: form.description,
    };
    setCoupons((prev) => [newCoupon, ...prev]);
    setShowForm(false);
    toast({ title: "Coupon created", description: `Coupon "${form.code.toUpperCase()}" is now active.` });
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
              <input type="text" placeholder="Search coupons..." className="h-11 pl-10 pr-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all w-60 placeholder:text-foreground/30" />
            </div>
            <span className="text-xs text-foreground/30 ml-2">{coupons.length} coupons</span>
          </div>
          <Button className="gap-1.5 h-11 px-5 shadow-md" onClick={openForm}>
            <Plus className="w-4 h-4" strokeWidth={2} />
            Create Coupon
          </Button>
        </div>

        <div className="space-y-3">
          {coupons.map((coupon, i) => (
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
          ))}
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
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Tag className="w-4 h-4 text-primary" strokeWidth={1.5} /></div>
                  <h2 className="text-sm font-serif font-bold text-foreground">Create Coupon</h2>
                </div>
                <button onClick={() => setShowForm(false)} className="p-2 rounded-full hover:bg-muted transition-colors"><X className="w-5 h-5 text-foreground/60" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 md:p-8">
                <div className="max-w-lg mx-auto space-y-5">
                  <div>
                    <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Coupon Code *</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={form.code}
                        onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                        placeholder="e.g. SUMMER25"
                        className="w-full h-12 px-4 text-sm font-mono font-bold tracking-widest bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25 uppercase"
                        maxLength={15}
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] text-foreground/25 font-mono">{form.code.length}/15</span>
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
                    <Button variant="outline" onClick={() => setShowForm(false)} className="h-11 px-6">Cancel</Button>
                    <Button onClick={handleSubmit} className="h-11 px-8 gap-2 shadow-md">
                      <Leaf className="w-4 h-4" strokeWidth={1.5} />
                      Create Coupon
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
