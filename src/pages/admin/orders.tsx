import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Filter, ChevronRight, Clock } from "lucide-react";

const initialOrders = [
  { id: "#ORD-001", customer: "Priya Sharma", items: 2, total: 1298, status: "Delivered", date: "10 Jul 2026" },
  { id: "#ORD-002", customer: "Rahul Verma", items: 1, total: 699, status: "Shipped", date: "11 Jul 2026" },
  { id: "#ORD-003", customer: "Ananya Patel", items: 3, total: 1847, status: "Processing", date: "12 Jul 2026" },
  { id: "#ORD-004", customer: "Vikram Singh", items: 1, total: 449, status: "Pending", date: "13 Jul 2026" },
  { id: "#ORD-005", customer: "Meera Iyer", items: 2, total: 1398, status: "Delivered", date: "09 Jul 2026" },
  { id: "#ORD-006", customer: "Sneha Kapoor", items: 1, total: 799, status: "Shipped", date: "11 Jul 2026" },
];

function statusBadge(status: string) {
  const map: Record<string, string> = {
    Delivered: "bg-green-50 text-green-700 border-green-200",
    Shipped: "bg-blue-50 text-blue-700 border-blue-200",
    Processing: "bg-amber-50 text-amber-700 border-amber-200",
    Pending: "bg-gray-50 text-gray-500 border-gray-200",
  };
  return `px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${map[status] || map.Pending}`;
}

export default function AdminOrders() {
  const [orders] = useState(initialOrders);

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
        </div>
      </div>

      <div className="space-y-3">
        {orders.map((order, i) => (
          <motion.div
            key={order.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.05 }}
            className="bg-white rounded-2xl border border-border/40 p-5 hover:border-primary/20 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.02)] transition-all duration-300 flex flex-col md:flex-row md:items-center justify-between gap-4 group/ord cursor-pointer"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-10 h-10 rounded-full bg-primary/5 flex items-center justify-center text-xs font-bold text-primary border border-primary/10 shrink-0 group-hover/ord:bg-primary group-hover/ord:text-white transition-colors duration-300">
                {order.customer.split(" ").map((n) => n[0]).join("")}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground truncate">{order.customer}</h3>
                <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-0.5 text-xs text-foreground/40">
                  <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded font-medium">{order.id}</span>
                  <span>•</span>
                  <span>{order.date}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 pt-3 md:pt-0 border-border/10 shrink-0">
              <div className="text-left md:text-right">
                <p className="text-xs text-foreground/40 font-medium">Items</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">{order.items} unit{order.items !== 1 ? "s" : ""}</p>
              </div>

              <div className="text-left md:text-right">
                <p className="text-xs text-foreground/40 font-medium">Total Amount</p>
                <p className="text-sm font-bold text-foreground mt-0.5">₹{order.total}</p>
              </div>

              <div className="w-24 text-right">
                <span className={statusBadge(order.status)}>{order.status}</span>
              </div>

              <button className="p-2 rounded-lg bg-[#fafaf8] text-foreground/30 group-hover/ord:text-primary group-hover/ord:bg-primary/5 transition-colors">
                <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
