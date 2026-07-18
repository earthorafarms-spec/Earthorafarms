import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, Filter, ChevronRight, Clock, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";



function statusBadge(status: string) {
  const map: Record<string, string> = {
    delivered: "bg-green-50 text-green-700 border-green-200",
    shipped: "bg-blue-50 text-blue-700 border-blue-200",
    processing: "bg-amber-50 text-amber-700 border-amber-200",
    pending: "bg-gray-50 text-gray-500 border-gray-200",
    cancelled: "bg-red-50 text-red-500 border-red-200",
    refunded: "bg-purple-50 text-purple-500 border-purple-200",
  };
  const normalized = status.toLowerCase();
  return `px-2.5 py-1 rounded-lg text-[11px] font-semibold border capitalize cursor-pointer hover:opacity-85 ${map[normalized] || map.pending}`;
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchOrders = async () => {
    try {

      const { data: rawData, error } = await supabase
        .from("orders")
        .select("*, order_items(*, products(name, slug))")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const data = rawData as any[];
      const mapped = data.map((o: any) => {
        const itemsCount = o.order_items ? o.order_items.reduce((acc: number, item: any) => acc + (item.quantity || 0), 0) : 0;
        return {
          id: o.id,
          orderNumber: o.order_number,
          customer: (o.shipping_address as any)?.name || "Unknown Customer",
          items: itemsCount,
          total: Number(o.total_amount),
          status: o.status,
          date: new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
        };
      });

      setOrders(mapped);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Fetch failed", description: err.message || "Failed to load orders.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const cycleStatus = async (orderId: string, currentStatus: string) => {
    const statuses = ["pending", "processing", "shipped", "delivered", "cancelled", "refunded"];
    const nextIdx = (statuses.indexOf(currentStatus.toLowerCase()) + 1) % statuses.length;
    const nextStatus = statuses[nextIdx];
    
    try {
      const { error } = await (supabase.from("orders") as any)
        .update({ status: nextStatus })
        .eq("id", orderId);
      if (error) throw error;
      toast({ title: "Order updated", description: `Status changed to ${nextStatus}.` });
      fetchOrders();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  };

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel("orders-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => {
          fetchOrders();
        }
      )
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
    return undefined;
  }, []);

  return (
    <motion.div
      key="orders"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/30" strokeWidth={1.5} />
            <input type="text" placeholder="Search orders..." className="h-11 pl-10 pr-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all w-60 placeholder:text-foreground/30" />
          </div>
          <button className="h-11 px-3.5 rounded-xl border border-border/40 bg-white text-foreground/50 hover:text-foreground hover:border-border/60 hover:bg-muted/10 transition-all">
            <Filter className="w-4 h-4" strokeWidth={1.5} />
          </button>
          <span className="text-xs text-foreground/30 ml-2">{orders.length} orders total</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-foreground/40 font-medium">
          <Clock className="w-3.5 h-3.5" strokeWidth={1.5} />
          <span>Last updated just now</span>
          <button onClick={fetchOrders} className="p-1 rounded hover:bg-muted ml-1 transition-colors" title="Reload orders">
            <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-20 text-foreground/40 text-xs">
            Loading orders...
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20 bg-white border border-border/40 rounded-2xl text-foreground/40 font-medium">
            No orders yet.
          </div>
        ) : (
          orders.map((order, i) => (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.05 }}
              className="bg-white rounded-2xl border border-border/40 p-5 hover:border-primary/20 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.02)] transition-all duration-300 flex flex-col md:flex-row md:items-center justify-between gap-4 group/ord cursor-pointer"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-10 h-10 rounded-full bg-primary/5 flex items-center justify-center text-xs font-bold text-primary border border-primary/10 shrink-0 group-hover/ord:bg-primary group-hover/ord:text-white transition-colors duration-300">
                  {order.customer.split(" ").map((n: string) => n[0]).join("")}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground truncate">{order.customer}</h3>
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-0.5 text-xs text-foreground/40">
                    <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded font-medium">{order.orderNumber || order.id}</span>
                    <span>•</span>
                    <span>{order.date}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 pt-3 md:pt-0 border-border/10 shrink-0">
                <div className="text-left md:text-right">
                  <p className="text-xs text-foreground/45 font-medium">Items</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{order.items} unit{order.items !== 1 ? "s" : ""}</p>
                </div>

                <div className="text-left md:text-right">
                  <p className="text-xs text-foreground/45 font-medium">Total Amount</p>
                  <p className="text-sm font-bold text-foreground mt-0.5">₹{order.total}</p>
                </div>

                <div className="w-24 text-right" onClick={(e) => { e.stopPropagation(); cycleStatus(order.id, order.status); }}>
                  <span className={statusBadge(order.status)}>{order.status}</span>
                </div>

                <button className="p-2 rounded-lg bg-[#fafaf8] text-foreground/30 group-hover/ord:text-primary group-hover/ord:bg-primary/5 transition-colors">
                  <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </motion.div>
  );
}
