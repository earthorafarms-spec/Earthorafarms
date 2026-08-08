import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Filter, Plus, Package, Eye, Trash2, X, Leaf, UploadCloud, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useEscapeKey } from "@/hooks/useEscapeKey";

import powderImg from "@assets/generated_images/product_powder.jpg";
import tabletsImg from "@assets/generated_images/product_tablets.jpg";

import heroLeavesImg from "@assets/generated_images/hero_leaves.jpg";

const staticFallbackMap: Record<string, string> = {
  powder: powderImg,
  tablets: tabletsImg,

  amla: heroLeavesImg,
};

interface ProductImage {
  url: string;
  alt: string;
  is_primary: boolean;
}

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
  images: ProductImage[];
  hsn_code?: string;
}


export default function AdminProducts() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const { toast } = useToast();

  const [form, setForm] = useState({
    name: "", mrp: "", price: "", tag: "", badge: "", stockText: "", stock: "", description: "",
    highlights: [""], rating: "", category: "moringa", hsn_code: "12119029",
  });
  const [images, setImages] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  // Restock modal state
  const [restockModal, setRestockModal] = useState<{
    open: boolean;
    productId: string;
    productName: string;
    qty: string;
    notes: string;
    waitingCount: number;
    submitting: boolean;
  }>({
    open: false, productId: "", productName: "", qty: "", notes: "",
    waitingCount: 0, submitting: false,
  });

  useEscapeKey(() => setShowForm(false), showForm);
  useEscapeKey(() => setRestockModal((m) => ({ ...m, open: false })), restockModal.open);

  const fetchProducts = async () => {
    try {
      
      const { data: rawData, error } = await supabase
        .from("products")
        .select("*, inventory(*)")
        .neq("status", "archived")
        .order("created_at", { ascending: false });
        
      if (error) throw error;
      
      const data = rawData as any[];
      const mapped = data.map((p: any) => {
        const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
        return {
          id: p.id,
          name: p.name,
          mrp: Number(p.mrp),
          price: Number(p.price),
          stock: inv?.total_stock ?? 0,
          sold: 0,
          status: p.status,
          tag: p.tag || "",
          badge: p.badge || "",
          stockText: inv?.total_stock && inv.total_stock > 15 ? "In Stock" : "Low Stock",
          description: p.description || "",
          highlights: p.highlights || [],
          rating: Number(p.rating),
          images: Array.isArray(p.images) ? (p.images as any) : [],
          hsn_code: p.hsn_code || "12119029",
        };
      });
      setProducts(mapped);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Fetch failed", description: err.message || "Failed to load products.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    
    const channel = supabase
        .channel("inventory-changes")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "inventory" },
          () => {
            fetchProducts();
          }
        )
        .subscribe();
        
      return () => {
        supabase.removeChannel(channel);
      };
  }, []);

  const handleDeleteProduct = async (id: string) => {
    try {
      const { error } = await (supabase.from("products") as any)
        .update({ status: "archived" })
        .eq("id", id);
        
      if (error) throw error;
      toast({ title: "Product archived", description: "Product soft deleted successfully." });
      fetchProducts();
    } catch (err: any) {
      console.error("Soft delete failed:", err);
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const openRestockModal = async (product: AdminProduct) => {
    // Fetch waiting customer count
    let waitingCount = 0;
    try {
      const { count } = await (supabase
        .from("customer_restock_requests") as any)
        .select("*", { count: "exact", head: true })
        .eq("product_id", product.id)
        .eq("status", "waiting");
      waitingCount = count ?? 0;
    } catch (_) {
      // silently ignore — count badge is cosmetic
    }
    setRestockModal({
      open: true,
      productId: product.id,
      productName: product.name,
      qty: "",
      notes: "",
      waitingCount,
      submitting: false,
    });
  };

  const handleRestockSubmit = async () => {
    const qty = parseInt(restockModal.qty);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: "Invalid quantity", description: "Please enter a positive number.", variant: "destructive" });
      return;
    }
    setRestockModal(m => ({ ...m, submitting: true }));
    try {
      const { error } = await (supabase.rpc as any)("restock_product", {
        p_product_id: restockModal.productId,
        p_quantity: qty,
        p_notes: restockModal.notes || "Restocked via admin portal",
      });
      if (error) throw error;
      toast({ title: "Product restocked", description: `Added ${qty} units to inventory.` });
      setRestockModal(m => ({ ...m, open: false }));
      fetchProducts();
    } catch (err: any) {
      toast({ title: "Restock failed", description: err.message, variant: "destructive" });
      setRestockModal(m => ({ ...m, submitting: false }));
    }
  };

  const openForm = () => {
    setEditId(null);
    setForm({ name: "", mrp: "", price: "", tag: "", badge: "", stockText: "In Stock", stock: "", description: "", highlights: [""], rating: "4.5", category: "moringa", hsn_code: "12119029" });
    setImages([]);
    setSelectedFiles([]);
    setShowForm(true);
  };

  const openEditForm = (p: AdminProduct) => {
    setEditId(p.id);
    setForm({
      name: p.name,
      mrp: String(p.mrp),
      price: String(p.price),
      tag: p.tag || "",
      badge: p.badge || "",
      stockText: p.stockText || "In Stock",
      stock: String(p.stock),
      description: p.description || "",
      highlights: p.highlights?.length ? p.highlights : [""],
      rating: String(p.rating || 4.5),
      category: "moringa",
      hsn_code: p.hsn_code || "12119029",
    });
    // Load existing product images as preview urls
    const existingImgUrls = (p.images || []).map((img: any) => img.url || img);
    setImages(existingImgUrls);
    setSelectedFiles([]);
    setShowForm(true);
  };

  const addHighlight = () => setForm((f) => ({ ...f, highlights: [...f.highlights, ""] }));
  const removeHighlight = (i: number) => setForm((f) => ({ ...f, highlights: f.highlights.filter((_, idx) => idx !== i) }));
  const setHighlight = (i: number, v: string) => setForm((f) => {
    const h = [...f.highlights];
    h[i] = v;
    return { ...f, highlights: h };
  });

  const handleSubmit = async () => {
    if (!form.name || !form.mrp || !form.price) {
      toast({ title: "Missing fields", description: "Name, MRP, and Price are required." });
      return;
    }

    setUploading(true);
    const mrp = parseFloat(form.mrp);
    const price = parseFloat(form.price);
    const baseSlug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "product";
    let id = baseSlug;

    if (!editId) {
      try {
        const { data: existingSlug } = await (supabase.from("products") as any)
          .select("slug")
          .eq("slug", baseSlug)
          .maybeSingle();

        if (existingSlug) {
          id = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;
        }
      } catch (_) {
        // fallback if check fails
      }
    }

    let finalImages: ProductImage[] = [];

    if (selectedFiles.length > 0) {
      toast({ title: "Uploading images", description: "Please wait while we upload and compress product images..." });
      try {
        for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          const isPrimary = i === 0;
          
          const adminPassword = sessionStorage.getItem("admin_password") || "";
          const formData = new FormData();
          formData.append("file", file);
          formData.append("product_id", id);
          formData.append("product_slug", id);
          formData.append("is_primary", String(isPrimary));
          formData.append("alt", `${form.name} view ${i + 1}`);
          formData.append("password", adminPassword);

          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-product-image`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              "x-admin-password": adminPassword,
            },
            body: formData
          });

          if (!response.ok) {
            const errBody = await response.json();
            throw new Error(errBody.error || "Failed to upload image");
          }

          const resData = await response.json();
          finalImages.push({
            url: resData.url,
            alt: `${form.name} view ${i + 1}`,
            is_primary: isPrimary
          });
        }
      } catch (err: any) {
        console.error("Image upload failed:", err);
        toast({ title: "Upload failed", description: err.message || "Failed to upload images, falling back to local previews.", variant: "destructive" });
        finalImages = images.map((url, i) => ({
          url,
          alt: `${form.name} view ${i + 1}`,
          is_primary: i === 0
        }));
      }
    } else {
      finalImages = images.map((url, i) => ({
        url,
        alt: `${form.name} view ${i + 1}`,
        is_primary: i === 0
      }));
    }

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
      images: finalImages,
    };

    try {
      if (editId) {
        // ── UPDATE existing product ──────────────────────────────────────────
        const { error: updErr } = await (supabase
          .from("products") as any)
          .update({
            name: form.name,
            mrp,
            price,
            tag: form.tag,
            badge: form.badge,
            description: form.description,
            highlights: form.highlights.filter((h) => h.trim()),
            rating: parseFloat(form.rating) || 4.5,
            category: form.category || "moringa",
            hsn_code: form.hsn_code,
            ...(finalImages.length > 0 ? { images: finalImages as any } : {}),
          })
          .eq("id", editId);

        if (updErr) throw updErr;

        // Update stock in inventory
        await (supabase
          .from("inventory") as any)
          .update({ total_stock: parseInt(form.stock) || 0 })
          .eq("product_id", editId);

        toast({ title: "Product updated", description: `${form.name} has been updated.` });
        setImages([]);
        setSelectedFiles([]);
        setUploading(false);
        setShowForm(false);
        setEditId(null);
        fetchProducts();
        return;
      }

      const { data: newProd, error: prodErr } = await (supabase.from("products") as any)
        .insert({
          slug: id,
          name: form.name,
          mrp,
          price,
          tag: form.tag,
          badge: form.badge,
          status: "active",
          description: form.description,
          highlights: form.highlights.filter((h) => h.trim()),
          rating: parseFloat(form.rating) || 4.5,
          images: finalImages as any,
          category: form.category || "moringa",
          hsn_code: form.hsn_code,
        })
        .select()
        .single();

      if (prodErr) throw prodErr;

      const { error: invErr } = await supabase
        .from("inventory")
        .insert({
          product_id: (newProd as any).id,
          total_stock: parseInt(form.stock) || 0,
          reserved_stock: 0,
          low_stock_threshold: 15,
        } as any);

      if (invErr) throw invErr;

      toast({ title: "Product added", description: `${form.name} has been created in database.` });
      fetchProducts();
    } catch (err: any) {
      console.error("Insert failed:", err);
      toast({ title: "Failed to add product", description: err.message, variant: "destructive" });
    }

    setImages([]);
    setSelectedFiles([]);
    setUploading(false);
    setShowForm(false);
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

        <div className="w-full">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-foreground/40">
              Loading products...
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-20 bg-white border border-border/40 rounded-2xl text-foreground/40 font-medium">
              No products yet. Add your first product.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {products.map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.05 }}
                  className="bg-white rounded-2xl border border-border/40 overflow-hidden shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.03)] hover:border-primary/20 transition-all duration-300 flex flex-col group/prod"
                >
                  <div className="relative aspect-square bg-[#fafaf8] flex items-center justify-center border-b border-border/20 group-hover/prod:bg-primary/[0.02] transition-colors duration-300 overflow-hidden">
                    {(() => {
                      const rawUrl = p.images?.find((img) => img.is_primary)?.url || p.images?.[0]?.url;
                      const hasValidUrl = rawUrl && !rawUrl.includes("undefined") && rawUrl.startsWith("http");
                      
                      let displaySrc = hasValidUrl ? rawUrl : null;
                      if (!displaySrc) {
                        const slug = p.name.toLowerCase();
                        if (slug.includes("amla")) displaySrc = staticFallbackMap.amla;
                        else if (slug.includes("tablets")) displaySrc = staticFallbackMap.tablets;
                        else displaySrc = staticFallbackMap.powder;
                      }

                      return (
                        <img 
                          src={displaySrc} 
                          alt={p.name} 
                          className="object-cover w-full h-full transition-transform duration-500 group-hover/prod:scale-105" 
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = staticFallbackMap.powder;
                          }}
                        />
                      );
                    })()}
                    <span className="absolute top-4 right-4 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-green-50/90 text-green-700 border border-green-200 backdrop-blur-sm">Active</span>
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
                          <button onClick={() => openRestockModal(p)} className="p-2 rounded-lg bg-[#fafaf8] text-foreground/40 hover:text-primary hover:bg-primary/5 transition-colors" title="Restock product">
                            <Plus className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                          <button onClick={() => openEditForm(p)} className="p-2 rounded-lg bg-[#fafaf8] text-foreground/40 hover:text-primary hover:bg-primary/5 transition-colors" title="Edit product"><Eye className="w-4 h-4" strokeWidth={1.5} /></button>
                          <button onClick={() => handleDeleteProduct(p.id)} className="p-2 rounded-lg bg-[#fafaf8] text-foreground/40 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete product"><Trash2 className="w-4 h-4" strokeWidth={1.5} /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
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
                  <h2 className="text-sm font-serif font-bold text-foreground">{editId ? "Edit Product" : "Add New Product"}</h2>
                </div>
                <button onClick={() => { setShowForm(false); setEditId(null); }} className="p-2 rounded-full hover:bg-muted transition-colors"><X className="w-5 h-5 text-foreground/60" /></button>
              </div>

              <div className="flex-1 overflow-y-auto">
                <div className="flex flex-col lg:flex-row min-h-full">
                  <div className="lg:w-[40%] bg-[#fafaf8] p-8 lg:p-10 flex flex-col items-center justify-start border-b lg:border-b-0 lg:border-r border-border/20">
                    <div className="w-full max-w-xs">
                      <h3 className="text-xs font-semibold text-foreground/50 uppercase tracking-widest mb-4 text-center">Product Images</h3>

                      <div
                        onClick={() => document.getElementById("multi-img-input")?.click()}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.add("border-primary", "bg-primary/[0.04]");
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.classList.remove("border-primary", "bg-primary/[0.04]");
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove("border-primary", "bg-primary/[0.04]");
                          const files = e.dataTransfer.files;
                          if (files) {
                            const validFiles = Array.from(files).filter(f => f.size <= 5 * 1024 * 1024);
                            if (validFiles.length < files.length) {
                              toast({ title: "Files skipped", description: "Some files exceeded the 5MB size limit.", variant: "destructive" });
                            }
                            const newImages = validFiles.map((f) => URL.createObjectURL(f));
                            setImages((prev) => [...prev, ...newImages]);
                            setSelectedFiles((prev) => [...prev, ...validFiles]);
                          }
                        }}
                        className="rounded-2xl border-2 border-dashed border-border/50 bg-white flex flex-col items-center justify-center cursor-pointer hover:border-primary/40 hover:bg-primary/[0.02] transition-all group relative overflow-hidden h-[380px]"
                      >
                        {images.length > 0 ? (
                          <div className="w-full h-full p-4 flex items-center justify-center relative">
                            <img src={images[0]} alt="Primary" className="max-w-full max-h-full object-contain" />
                            {uploading && (
                              <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center text-white text-xs font-semibold gap-2">
                                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Uploading to storage...
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-center p-4">
                            <div className="w-12 h-12 rounded-xl bg-primary/8 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                              <UploadCloud className="w-5 h-5 text-primary/50" />
                            </div>
                            <p className="text-xs text-foreground/40 font-medium">Click or drag images here</p>
                            <p className="text-[10px] text-foreground/25 mt-1">PNG, JPG, WEBP up to 5MB</p>
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
                              const validFiles = Array.from(files).filter(f => f.size <= 5 * 1024 * 1024);
                              if (validFiles.length < files.length) {
                                toast({ title: "Files skipped", description: "Some files exceeded the 5MB size limit.", variant: "destructive" });
                              }
                              const newImages = validFiles.map((f) => URL.createObjectURL(f));
                              setImages((prev) => [...prev, ...newImages]);
                              setSelectedFiles((prev) => [...prev, ...validFiles]);
                            }
                          }}
                        />
                      </div>

                      {images.length > 1 && (
                        <div className="grid grid-cols-4 gap-2 mt-4">
                          {images.slice(1).map((src, i) => (
                            <div key={i} className="aspect-square rounded-xl border border-border/30 bg-white p-2 relative group/img">
                              <img src={src} alt="" className="w-full h-full object-contain" />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setImages((prev) => prev.filter((_, idx) => idx !== i + 1));
                                  setSelectedFiles((prev) => prev.filter((_, idx) => idx !== i + 1));
                                }}
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
                          type="button"
                          onClick={() => {
                            setImages([]);
                            setSelectedFiles([]);
                          }}
                          className="w-full text-xs text-foreground/30 hover:text-red-500 transition-colors py-2 mt-2"
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
                        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Organic Moringa Powder" className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25" />
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

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Tag / Subtitle</label>
                          <input type="text" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} placeholder="500mg · 90 Capsules" className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Badge</label>
                          <input type="text" value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} placeholder="Best Seller, New, etc." className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Category *</label>
                          <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. moringa, amla" className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">HSN Code *</label>
                          <input type="text" required value={form.hsn_code} onChange={(e) => setForm({ ...form, hsn_code: e.target.value })} placeholder="12119029" className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25" />
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
                        <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); }} className="h-11 px-6">Cancel</Button>
                        <Button onClick={handleSubmit} className="h-11 px-8 gap-2 shadow-md">
                          <Leaf className="w-4 h-4" strokeWidth={1.5} />
                          {editId ? "Save Changes" : "Create Product"}
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

      {/* ── Restock Modal ────────────────────────────────────────────── */}
      <AnimatePresence>
        {restockModal.open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              onClick={() => setRestockModal(m => ({ ...m, open: false }))}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div className="bg-card border border-border/50 rounded-2xl shadow-2xl w-full max-w-md p-6 pointer-events-auto">
                {/* Header */}
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <h2 className="text-base font-semibold text-foreground mb-1">Restock Product</h2>
                    <p className="text-xs text-foreground/50">{restockModal.productName}</p>
                  </div>
                  <button onClick={() => setRestockModal(m => ({ ...m, open: false }))} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                    <X className="w-4 h-4 text-foreground/50" />
                  </button>
                </div>

                {/* Waiting customers badge */}
                {restockModal.waitingCount > 0 && (
                  <div className="flex items-center gap-2 p-3 mb-5 rounded-xl bg-primary/8 border border-primary/20">
                    <Users className="w-4 h-4 text-primary shrink-0" />
                    <p className="text-xs text-primary font-medium">
                      <span className="font-bold">{restockModal.waitingCount}</span> customer{restockModal.waitingCount !== 1 ? "s" : ""} waiting, 
                      they'll be automatically SMS-notified when you restock.
                    </p>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground/70 mb-1.5">
                      Quantity to Add <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={restockModal.qty}
                      onChange={e => setRestockModal(m => ({ ...m, qty: e.target.value }))}
                      placeholder="e.g. 100"
                      className="w-full px-3 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground/70 mb-1.5">
                      Notes <span className="text-foreground/30">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={restockModal.notes}
                      onChange={e => setRestockModal(m => ({ ...m, notes: e.target.value }))}
                      placeholder="e.g. New batch from supplier"
                      className="w-full px-3 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>

                  <div className="flex gap-3 pt-1">
                    <Button variant="outline" className="flex-1 h-11" onClick={() => setRestockModal(m => ({ ...m, open: false }))}>
                      Cancel
                    </Button>
                    <Button className="flex-1 h-11 gap-2" onClick={handleRestockSubmit} disabled={restockModal.submitting}>
                      <Plus className="w-4 h-4" strokeWidth={1.5} />
                      {restockModal.submitting ? "Restocking..." : "Confirm Restock"}
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
