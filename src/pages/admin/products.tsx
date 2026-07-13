import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Filter, Plus, Package, Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const initialProducts = [
  { id: "capsules", name: "Organic Moringa Capsules", price: 699, stock: 42, sold: 128, status: "Active" },
  { id: "powder", name: "Pure Moringa Leaf Powder", price: 599, stock: 28, sold: 94, status: "Active" },
  { id: "tablets", name: "Pressed Moringa Tablets", price: 799, stock: 15, sold: 67, status: "Active" },
  { id: "amla", name: "Organic Amla Powder", price: 449, stock: 33, sold: 52, status: "Active" },
];

export default function AdminProducts() {
  const [products, setProducts] = useState(initialProducts);
  const { toast } = useToast();

  const handleDeleteProduct = (id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    toast({ title: "Product removed", description: "The product has been deleted." });
  };

  return (
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
        <Button className="gap-1.5 h-11 px-5 shadow-md">
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
              <span className="absolute top-4 right-4 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-green-50 text-green-700 border border-green-200">
                Active
              </span>
            </div>
            <div className="p-5 flex flex-col flex-1">
              <h3 className="text-sm font-semibold text-foreground leading-snug truncate mb-1">{p.name}</h3>
              <p className="text-[11px] text-foreground/40 mb-4">Stock ID: {p.id.toUpperCase()}</p>

              <div className="space-y-3 mt-auto">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-foreground/45 font-medium">Price</span>
                  <span className="text-base font-bold text-foreground">₹{p.price}</span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-foreground/40">Stock ({p.stock} units)</span>
                    <span className={p.stock < 20 ? "text-red-500 font-bold" : p.stock < 30 ? "text-amber-500 font-bold" : "text-green-500 font-bold"}>
                      {p.stock < 20 ? "Low Stock" : p.stock < 30 ? "Medium" : "In Stock"}
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-border/40 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${p.stock < 20 ? "bg-red-500" : p.stock < 30 ? "bg-amber-500" : "bg-green-500"}`}
                      style={{ width: `${Math.min(100, (p.stock / 50) * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-border/10 flex items-center justify-between">
                  <span className="text-xs text-foreground/40 font-semibold">Sold: <span className="text-foreground font-bold ml-0.5">{p.sold}</span></span>
                  <div className="flex gap-1">
                    <button className="p-2 rounded-lg bg-[#fafaf8] text-foreground/40 hover:text-foreground hover:bg-muted/10 transition-colors" title="View details">
                      <Eye className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                    <button onClick={() => handleDeleteProduct(p.id)} className="p-2 rounded-lg bg-[#fafaf8] text-foreground/40 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete product">
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
