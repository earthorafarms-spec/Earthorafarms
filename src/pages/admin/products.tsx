import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Filter, Plus, Package, Eye, Trash2, X, Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface AdminProduct {
  id: string;
  name: string;
  mrp: number;
  price: number;
  stock: number;
  sold: number;
  status: string;
  tag: string;
  badge: string;
  stockText: string;
  description: string;
  highlights: string[];
  rating: number;
}

const initialProducts: AdminProduct[] = [
  { id: "capsules", name: "Organic Moringa Capsules", mrp: 999, price: 699, stock: 42, sold: 128, status: "Active", tag: "500mg · 90 Capsules", badge: "Best Seller", stockText: "In Stock", description: "Our premium moringa capsules deliver the full nutritional profile of fresh moringa leaves.", highlights: ["500 mg organic moringa leaf per capsule", "90 vegetable capsules — 3 month supply", "No fillers, binders, or flow agents"], rating: 4.6 },
  { id: "powder", name: "Pure Moringa Leaf Powder", mrp: 849, price: 599, stock: 28, sold: 94, status: "Active", tag: "8 oz · Resealable Pouch", badge: "Most Popular", stockText: "In Stock", description: "Harvested by hand and stone-ground to preserve nutrients.", highlights: ["100% pure shade-dried moringa leaf powder", "Stone-ground at low temperature", "Smooth texture — blends instantly"], rating: 4.7 },
  { id: "tablets", name: "Pressed Moringa Tablets", mrp: 1099, price: 799, stock: 15, sold: 67, status: "Active", tag: "500mg · 120 Tablets", badge: "Value Pack", stockText: "In Stock", description: "Our pressed moringa tablets contain nothing but the leaf — no magnesium stearate.", highlights: ["500 mg pressed moringa per tablet", "120 tablets — 4 month supply", "Zero binders, fillers, or coatings"], rating: 4.8 },
  { id: "amla", name: "Organic Amla Powder", mrp: 649, price: 449, stock: 33, sold: 52, status: "Active", tag: "8 oz · Resealable Pouch", badge: "New", stockText: "In Stock", description: "Sourced from wild-grown amla trees, cold-pressed to retain natural vitamin C.", highlights: ["100% pure wild-harvested amla fruit powder", "Cold-pressed to preserve natural vitamin C", "Supports immunity, hair health & digestion"], rating: 4.7 },
];

export default function AdminProducts() {
  const [products, setProducts] = useState(initialProducts);
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();

  const [form, setForm] = useState({
    name: "", mrp: "", price: "", tag: "", badge: "", stockText: "", stock: "", description: "",
    highlights: [""], rating: "",
  });
  const [images, setImages] = useState<string[]>([]);

  const handleDeleteProduct = (id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    toast({ title: "Product removed", description: "The product has been deleted." });
  };

  const openForm = () => {
    setForm({ name: "", mrp: "", price: "", tag: "", badge: "", stockText: "In Stock", stock: "", description: "", highlights: [""], rating: "4.5" });
    setShowForm(true);
  };

  const addHighlight = () => setForm((f) => ({ ...f, highlights: [...f.highlights, ""] }));
  const removeHighlight = (i: number) => setForm((f) => ({ ...f, highlights: f.highlights.filter((_, idx) => idx !== i) }));
  const setHighlight = (i: number, v: string) => setForm((f) => {
    const h = [...f.highlights];
    h[i] = v;
    return { ...f, highlights: h };
  });

  const handleSubmit = () => {
    if (!form.name || !form.mrp || !form.price) {
      toast({ title: "Missing fields", description: "Name, MRP, and Price are required." });
      return;
    }
    const mrp = parseFloat(form.mrp);
    const price = parseFloat(form.price);
    const id = form.name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/(^-|-$)/g, "");
    const newProduct: AdminProduct = {
      id,
      name: form.name,
      mrp,
      price,
      stock: parseInt(form.stock) || 0,
      sold: 0,
      status: "Active",
      tag: form.tag,
      badge: form.badge,
      stockText: form.stockText || "In Stock",
      description: form.description,
      highlights: form.highlights.filter((h) => h.trim()),
      rating: parseFloat(form.rating) || 4.5,
    };
    setProducts((prev) => [newProduct, ...prev]);
    setShowForm(false);
    toast({ title: "Product added", description: `${form.name} has been created successfully.` });
  };

  const discount = form.mrp && form.price ? Math.round((1 - parseFloat(form.price) / parseFloat(form.mrp)) * 100) : 0;

  return (
    <>
      <motion.div
        key="products"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/30" strokeWidth={1.5} />
              <input type="text" placeholder="Search products..." className="h-11 pl-10 pr-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all w-60 placeholder:text-foreground/30" />
            </div>
            <button className="h-11 px-3.5 rounded-xl border border-border/40 bg-white text-foreground/50 hover:text-foreground hover:border-border/60 hover:bg-muted/10 transition-all">
              <Filter className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <span className="text-xs text-foreground/30 ml-2">{products.length} products total</span>
          </div>
          <Button className="gap-1.5 h-11 px-5 shadow-md" onClick={openForm}>
            <Plus className="w-4 h-4" strokeWidth={2} />
            Add Product
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {products.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.05 }}
              className="bg-white rounded-2xl border border-border/40 overflow-hidden shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.03)] hover:border-primary/20 transition-all duration-300 flex flex-col group/prod"
            >
              <div className="relative aspect-square bg-[#fafaf8] flex items-center justify-center p-6 border-b border-border/20 group-hover/prod:bg-primary/[0.02] transition-colors duration-300">
                <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-sm border border-border/10">
                  <Package className="w-8 h-8 text-primary" strokeWidth={1.5} />
                </div>
                <span className="absolute top-4 right-4 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-green-50 text-green-700 border border-green-200">Active</span>
              </div>
              <div className="p-5 flex flex-col flex-1">
                <h3 className="text-sm font-semibold text-foreground leading-snug truncate mb-1">{p.name}</h3>
                <p className="text-[11px] text-foreground/40 mb-4">Stock ID: {p.id.toUpperCase()}</p>
                <div className="space-y-3 mt-auto">
                  {p.badge && <span className="inline-block px-2 py-0.5 text-[10px] font-bold bg-primary/10 text-primary rounded">{p.badge}</span>}
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-foreground/45 font-medium">Price</span>
                    <div className="text-right">
                      <span className="text-base font-bold text-foreground">{p.price}</span>
                      <span className="text-[10px] text-foreground/30 line-through ml-1.5">{p.mrp}</span>
                      <span className="text-[10px] text-accent font-bold ml-1">{Math.round((1 - p.price / p.mrp) * 100)}% off</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-foreground/40">Stock ({p.stock} units)</span>
                      <span className={p.stock < 20 ? "text-red-500 font-bold" : p.stock < 30 ? "text-amber-500 font-bold" : "text-green-500 font-bold"}>
                        {p.stock < 20 ? "Low Stock" : p.stock < 30 ? "Medium" : "In Stock"}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-border/40 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${p.stock < 20 ? "bg-red-500" : p.stock < 30 ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${Math.min(100, (p.stock / 50) * 100)}%` }} />
                    </div>
                  </div>
                  <div className="pt-3 border-t border-border/10 flex items-center justify-between">
                    <span className="text-xs text-foreground/40 font-semibold">Sold: <span className="text-foreground font-bold ml-0.5">{p.sold}</span></span>
                    <div className="flex gap-1">
                      <button className="p-2 rounded-lg bg-[#fafaf8] text-foreground/40 hover:text-foreground hover:bg-muted/10 transition-colors" title="View details"><Eye className="w-4 h-4" strokeWidth={1.5} /></button>
                      <button onClick={() => handleDeleteProduct(p.id)} className="p-2 rounded-lg bg-[#fafaf8] text-foreground/40 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete product"><Trash2 className="w-4 h-4" strokeWidth={1.5} /></button>
                    </div>
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
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-0 md:inset-x-20 md:inset-y-8 max-w-5xl mx-auto z-50 bg-background md:rounded-2xl overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between px-6 md:px-8 h-16 border-b border-border/30 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Leaf className="w-4 h-4 text-primary" strokeWidth={1.5} /></div>
                  <h2 className="text-sm font-serif font-bold text-foreground">Add New Product</h2>
                </div>
                <button onClick={() => setShowForm(false)} className="p-2 rounded-full hover:bg-muted transition-colors"><X className="w-5 h-5 text-foreground/60" /></button>
              </div>

              <div className="flex-1 overflow-y-auto">
                <div className="flex flex-col lg:flex-row min-h-full">
                  <div className="lg:w-[40%] bg-[#fafaf8] p-8 lg:p-10 flex flex-col items-center justify-start border-b lg:border-b-0 lg:border-r border-border/20">
                    <div className="w-full max-w-xs">
                      <h3 className="text-xs font-semibold text-foreground/50 uppercase tracking-widest mb-4 text-center">Product Images</h3>

                      <div
                        onClick={() => document.getElementById("multi-img-input")?.click()}
                        className="rounded-2xl border-2 border-dashed border-border/50 bg-white flex flex-col items-center justify-center cursor-pointer hover:border-primary/40 hover:bg-primary/[0.02] transition-all group relative overflow-hidden h-[380px]"
                      >
                        {images.length > 0 ? (
                          <img src={images[0]} alt="Primary" className="w-full h-full object-contain p-4" />
                        ) : (
                          <div className="text-center p-4">
                            <div className="w-12 h-12 rounded-xl bg-primary/8 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                              <svg className="w-5 h-5 text-primary/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            </div>
                            <p className="text-xs text-foreground/40 font-medium">Click to upload</p>
                            <p className="text-[10px] text-foreground/25 mt-1">PNG, JPG up to 5MB each</p>
                          </div>
                        )}
                        <input
                          id="multi-img-input"
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const files = e.target.files;
                            if (files) {
                              const newImages = Array.from(files).map((f) => URL.createObjectURL(f));
                              setImages((prev) => [...prev, ...newImages]);
                            }
                          }}
                        />
                      </div>

                      {images.length > 1 && (
                        <div className="grid grid-cols-4 gap-2 mb-4">
                          {images.slice(1).map((src, i) => (
                            <div key={i} className="aspect-square rounded-xl border border-border/30 bg-white p-2 relative group/img">
                              <img src={src} alt="" className="w-full h-full object-contain" />
                              <button
                                onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i + 1))}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity shadow-sm"
                              >
                                <X className="w-3 h-3" strokeWidth={2} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {images.length > 0 && (
                        <button
                          onClick={() => setImages([])}
                          className="w-full text-xs text-foreground/30 hover:text-red-500 transition-colors py-1"
                        >
                          Clear all images ({images.length})
                        </button>
                      )}

                      <div className="mt-6 pt-6 border-t border-border/20">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-foreground/80">{form.price ? `₹${form.price}` : ""}</div>
                          <div className="flex items-center justify-center gap-2 mt-1">
                            {form.mrp && <span className="text-xs text-foreground/30 line-through">{form.mrp}</span>}
                            {discount > 0 && <span className="text-xs font-bold text-accent">-{discount}%</span>}
                          </div>
                          {form.name && (
                            <p className="text-xs text-foreground/50 mt-3 font-medium line-clamp-2">{form.name}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="lg:w-[60%] p-6 md:p-10 overflow-y-auto">
                    <div className="max-w-xl mx-auto space-y-5">
                      <div>
                        <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Product Name *</label>
                        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Organic Moringa Capsules" className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25" />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">MRP () *</label>
                          <input type="number" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} placeholder="999" className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Selling Price () *</label>
                          <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="699" className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                        </div>
                      </div>

                      {form.mrp && form.price && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="px-2 py-1 rounded-lg bg-accent/10 text-accent font-bold">{discount}% discount</span>
                          <span className="text-foreground/40">Savings: {Math.max(0, parseFloat(form.mrp) - parseFloat(form.price))}</span>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Tag / Subtitle</label>
                          <input type="text" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} placeholder="500mg · 90 Capsules" className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Badge</label>
                          <input type="text" value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} placeholder="Best Seller, New, etc." className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25" />
                        </div>
                      </div>

                       <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Stock Quantity</label>
                          <input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="50" className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Stock Status</label>
                          <div className="flex gap-1 bg-white border border-border/40 rounded-xl p-1 h-11">
                            {[
                              { value: "In Stock", label: "In Stock", color: "text-green-700" },
                              { value: "Low Stock", label: "Low", color: "text-amber-700" },
                              { value: "Out of Stock", label: "Out", color: "text-red-600" },
                            ].map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => setForm({ ...form, stockText: opt.value })}
                                className={`flex-1 rounded-lg text-[10px] font-semibold transition-all ${
                                  form.stockText === opt.value
                                    ? "bg-primary text-white shadow-sm"
                                    : `${opt.color} hover:bg-muted/50`
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Rating</label>
                          <div className="flex items-center gap-2 h-11 bg-white border border-border/40 rounded-xl px-3 outline-none focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/5 transition-all">
                            <input 
                              type="number" 
                              step="0.1" 
                              min="0" 
                              max="5" 
                              value={form.rating} 
                              onChange={(e) => setForm({ ...form, rating: e.target.value })} 
                              placeholder="4.5" 
                              className="w-10 bg-transparent text-sm outline-none placeholder:text-foreground/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" 
                            />
                            <span className="text-[10px] font-semibold text-foreground/45 whitespace-nowrap">/ 5 stars</span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Description</label>
                        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Describe the product..." className="w-full px-4 py-3 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all resize-none placeholder:text-foreground/25" />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">Highlights / Key Features</label>
                          <button type="button" onClick={addHighlight} className="text-xs text-primary hover:text-primary/70 font-medium flex items-center gap-1">
                            <Plus className="w-3 h-3" strokeWidth={2} /> Add
                          </button>
                        </div>
                        <div className="space-y-2">
                          {form.highlights.map((h, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={h}
                                onChange={(e) => setHighlight(i, e.target.value)}
                                placeholder={`Highlight ${i + 1}`}
                                className="flex-1 h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 transition-all placeholder:text-foreground/25"
                              />
                              {form.highlights.length > 1 && (
                                <button onClick={() => removeHighlight(i)} className="p-2 rounded-lg hover:bg-red-50 text-foreground/30 hover:text-red-500 transition-colors">
                                  <X className="w-4 h-4" strokeWidth={1.5} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-3 pt-5 border-t border-border/20">
                        <Button variant="outline" onClick={() => setShowForm(false)} className="h-11 px-6">Cancel</Button>
                        <Button onClick={handleSubmit} className="h-11 px-8 gap-2 shadow-md">
                          <Leaf className="w-4 h-4" strokeWidth={1.5} />
                          Create Product
                        </Button>
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
