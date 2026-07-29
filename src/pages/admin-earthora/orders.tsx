import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Filter, ChevronRight, Clock, RefreshCw, PackageOpen, Plus, User, MapPin, Phone, Mail, Package, X, Check, ShoppingCart } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useEscapeKey } from "@/hooks/useEscapeKey";

function statusBadge(status: string) {
  const map: Record<string, string> = {
    delivered: "bg-emerald-50 text-emerald-700 border-emerald-200/80 shadow-xs",
    shipped: "bg-sky-50 text-sky-700 border-sky-200/80 shadow-xs",
    packed: "bg-amber-50 text-amber-700 border-amber-200/80 shadow-xs",
    processing: "bg-indigo-50 text-indigo-700 border-indigo-200/80 shadow-xs",
    pending: "bg-slate-50 text-slate-600 border-slate-200/80 shadow-xs",
    cancelled: "bg-rose-50 text-rose-600 border-rose-200/80 shadow-xs",
    refunded: "bg-purple-50 text-purple-700 border-purple-200/80 shadow-xs",
  };
  const normalized = status?.toLowerCase() || "pending";
  return `px-3 py-1 rounded-xl text-[11px] font-bold border capitalize transition-all duration-200 inline-flex items-center gap-1.5 ${map[normalized] || map.pending}`;
}

const ALL_STATUSES = [
  { id: "pending", label: "Pending", color: "bg-slate-500" },
  { id: "processing", label: "Processing", color: "bg-indigo-500" },
  { id: "packed", label: "Packed", color: "bg-amber-500" },
  { id: "shipped", label: "Shipped", color: "bg-sky-500" },
  { id: "delivered", label: "Delivered", color: "bg-emerald-500" },
  { id: "cancelled", label: "Cancelled", color: "bg-rose-500" },
];

interface ProductItem {
  id: string;
  name: string;
  price: number;
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [availableProducts, setAvailableProducts] = useState<ProductItem[]>([]);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [activeStatusMenuId, setActiveStatusMenuId] = useState<string | null>(null);
  const { toast } = useToast();

  // New offline order form state — taking all checkout fields
  const [manualForm, setManualForm] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    country: "India",
    productId: "",
    quantity: "1",
    unitPrice: "",
    paymentStatus: "completed",
    orderStatus: "delivered",
  });

  useEscapeKey(() => setSelectedOrder(null), !!selectedOrder);
  useEscapeKey(() => setShowAddModal(false), showAddModal);
  useEscapeKey(() => setActiveStatusMenuId(null), !!activeStatusMenuId);

  // Fetch available products for manual creation
  const fetchAvailableProducts = async () => {
    try {
      const { data } = await supabase.from("products").select("id, name, price");
      if (data) {
        setAvailableProducts(data.map((p: any) => ({ id: p.id, name: p.name, price: Number(p.price || 0) })));
      }
    } catch (e) {
      console.error("Error fetching products:", e);
    }
  };

  const fetchOrders = async () => {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(`
          id,
          order_number,
          status,
          total_amount,
          shipping_address,
          created_at,
          order_items (
            id,
            quantity,
            unit_price,
            total_price,
            product_id,
            products (
              id,
              name,
              slug,
              images
            )
          )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const mapped = (data || []).map((o: any) => {
        const shipping = o.shipping_address || {};
        const itemsList = (o.order_items || []).map((item: any) => ({
          id: item.id,
          product_id: item.product_id,
          name: item.products?.name || item.product_id || "Moringa Product",
          quantity: Number(item.quantity || 1),
          unit_price: Number(item.unit_price || 0),
          total_price: Number(item.total_price || (item.unit_price * item.quantity) || 0),
          image: item.products?.images?.[0]?.url || "",
        }));

        const itemsCount = itemsList.reduce(
          (acc: number, item: any) => acc + (item.quantity || 0),
          0
        );

        return {
          id: o.id,
          orderNumber: o.order_number || o.id,
          customer: shipping.name || shipping.email || o.id,
          email: shipping.email || "",
          phone: shipping.phone || "",
          address: shipping.address || "",
          city: shipping.city || "",
          state: shipping.state || "",
          zip: shipping.zip || shipping.postalCode || "",
          country: shipping.country || "India",
          items: itemsCount,
          itemsList,
          total: Number(o.total_amount || 0),
          status: o.status || "pending",
          rawDate: o.created_at,
          date: new Date(o.created_at).toLocaleDateString("en-IN", {
            day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
          }),
        };
      });

      setOrders(mapped);
      setFiltered(mapped);
    } catch (err: any) {
      console.error("Orders fetch error:", err);
      toast({
        title: "Fetch failed",
        description: err.message || "Failed to load orders.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(orders);
    } else {
      const q = search.toLowerCase();
      setFiltered(
        orders.filter(
          (o) =>
            o.customer.toLowerCase().includes(q) ||
            o.orderNumber.toLowerCase().includes(q) ||
            o.email.toLowerCase().includes(q) ||
            o.status.toLowerCase().includes(q)
        )
      );
    }
  }, [search, orders]);

  const updateOrderStatus = async (orderId: string, nextStatus: string) => {
    setActiveStatusMenuId(null);
    setUpdatingId(orderId);
    try {
      const { error } = await (supabase
        .from("orders") as any)
        .update({ status: nextStatus })
        .eq("id", orderId);

      if (error) throw error;

      await (supabase.from("Order_history") as any).insert({
        order_id: orderId,
        order_status: nextStatus,
      });

      toast({ title: "Order status updated", description: `Changed to ${nextStatus}.` });
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o))
      );
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder((prev: any) => ({ ...prev, status: nextStatus }));
      }
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setUpdatingId(null);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchAvailableProducts();

    const channel = supabase
      .channel("orders-admin-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        fetchOrders();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "Orders" }, () => {
        setTimeout(fetchOrders, 800);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleCreateOfflineOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.customerName || !manualForm.productId) {
      toast({ title: "Missing fields", description: "Customer name and product selection are required.", variant: "destructive" });
      return;
    }

    setCreatingOrder(true);
    try {
      const selectedProd = availableProducts.find((p) => p.id === manualForm.productId);
      const qty = parseInt(manualForm.quantity) || 1;
      const unitPrice = parseFloat(manualForm.unitPrice) || selectedProd?.price || 0;
      const totalAmount = unitPrice * qty;
      const orderId = `OFFLINE-${Date.now().toString().slice(-6)}`;
      const customerEmail = manualForm.customerEmail || `offline_${Date.now()}@earthorafarms.com`;

      const shippingAddress = {
        name: manualForm.customerName,
        email: customerEmail,
        phone: manualForm.customerPhone,
        address: manualForm.address,
        city: manualForm.city,
        state: manualForm.state,
        zip: manualForm.zip,
        country: manualForm.country || "India",
      };

      // 1. Update/Insert User_details (same as checkout page)
      await (supabase.from("User_details") as any).upsert({
        user_email: customerEmail,
        user_name: manualForm.customerName,
        user_phone: manualForm.customerPhone,
        user_address: manualForm.address,
        user_city: manualForm.city,
        user_state: manualForm.state,
        user_zip: manualForm.zip,
        user_country: manualForm.country || "India",
      }, { onConflict: "user_email" });

      // 2. Insert into legacy Orders table (same as checkout page)
      await (supabase.from("Orders") as any).insert({
        order_user_id: customerEmail,
        order_product_id: manualForm.productId,
        order_product_quantity: String(qty),
        order_product_price: String(unitPrice),
      });

      // 3. Insert normalized order row for admin dashboard
      const { error: orderErr } = await (supabase.from("orders") as any).insert({
        id: orderId,
        order_number: orderId,
        user_id: customerEmail,
        status: manualForm.orderStatus || "delivered",
        total_amount: totalAmount,
        shipping_address: shippingAddress,
      });

      if (orderErr) throw orderErr;

      // 4. Insert order_items row
      await (supabase.from("order_items") as any).insert({
        order_id: orderId,
        product_id: manualForm.productId,
        quantity: qty,
        unit_price: unitPrice,
        total_price: totalAmount,
      });

      // 5. Insert payment record (same as checkout page)
      await (supabase.from("Payments") as any).insert({
        payment_order_id: orderId,
        payment_amount: String(totalAmount),
        payment_status: manualForm.paymentStatus || "completed",
        payment_method: "OFFLINE / CASH",
        payment_transaction_id: `POS-${Date.now()}`,
      });

      // 6. Insert order history record (same as checkout page)
      await (supabase.from("Order_history") as any).insert({
        order_id: orderId,
        order_status: manualForm.orderStatus || "delivered",
      });

      toast({ title: "Offline order created!", description: `Order #${orderId} saved to database.` });
      setShowAddModal(false);
      setManualForm({
        customerName: "",
        customerEmail: "",
        customerPhone: "",
        address: "",
        city: "",
        state: "",
        zip: "",
        country: "India",
        productId: "",
        quantity: "1",
        unitPrice: "",
        paymentStatus: "completed",
        orderStatus: "delivered",
      });
      fetchOrders();
    } catch (err: any) {
      console.error("Offline order creation error:", err);
      toast({ title: "Failed to create order", description: err.message || "Error saving offline order.", variant: "destructive" });
    } finally {
      setCreatingOrder(false);
    }
  };

  return (
    <>
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
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, order ID, email..."
                className="h-11 pl-10 pr-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all w-72 placeholder:text-foreground/30"
              />
            </div>
            <button className="h-11 px-3.5 rounded-xl border border-border/40 bg-white text-foreground/50 hover:text-foreground hover:border-border/60 hover:bg-muted/10 transition-all">
              <Filter className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <span className="text-xs text-foreground/30 ml-2">
              {filtered.length} order{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddModal(true)}
              className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-xs shadow-md shadow-primary/20 hover:bg-primary/90 transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Create Offline Order</span>
            </button>
            <div className="flex items-center gap-2 text-xs text-foreground/40 font-medium">
              <Clock className="w-3.5 h-3.5" strokeWidth={1.5} />
              <span>Live updates on</span>
              <button
                onClick={() => { setLoading(true); fetchOrders(); }}
                className="p-1 rounded hover:bg-muted ml-1 transition-colors"
                title="Reload orders"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              <p className="text-xs text-foreground/30">Loading orders...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 bg-white border border-border/40 rounded-2xl">
              <PackageOpen className="w-10 h-10 text-foreground/10 mx-auto mb-3" strokeWidth={1} />
              <p className="text-sm font-medium text-foreground/40">
                {search ? "No orders match your search." : "No orders yet."}
              </p>
              {search && (
                <button onClick={() => setSearch("")} className="mt-2 text-xs text-primary hover:underline">
                  Clear search
                </button>
              )}
            </div>
          ) : (
            filtered.map((order, i) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.04 }}
                className="bg-white rounded-2xl border border-border/40 p-5 hover:border-primary/20 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.03)] transition-all duration-300 flex flex-col md:flex-row md:items-center justify-between gap-4 group/ord cursor-pointer relative"
                onClick={() => setSelectedOrder(order)}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-primary/5 flex items-center justify-center text-xs font-bold text-primary border border-primary/10 shrink-0 group-hover/ord:bg-primary group-hover/ord:text-white transition-colors duration-300">
                    {order.customer.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate">{order.customer}</h3>
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-xs text-foreground/40">
                      <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded font-medium">
                        #{order.orderNumber}
                      </span>
                      <span>•</span>
                      <span>{order.date}</span>
                      {order.email && (
                        <>
                          <span>•</span>
                          <span className="truncate max-w-[180px]">{order.email}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-5 border-t md:border-t-0 pt-3 md:pt-0 border-border/10 shrink-0">
                  <div className="text-left md:text-right">
                    <p className="text-xs text-foreground/45 font-medium">Items</p>
                    <p className="text-sm font-semibold text-foreground mt-0.5">
                      {order.items} unit{order.items !== 1 ? "s" : ""}
                    </p>
                  </div>

                  <div className="text-left md:text-right">
                    <p className="text-xs text-foreground/45 font-medium">Total</p>
                    <p className="text-sm font-bold text-foreground mt-0.5">₹{order.total.toFixed(2)}</p>
                  </div>

                  {/* ── Redesigned Interactive Custom Status Dropdown ── */}
                  <div className="relative" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      disabled={updatingId === order.id}
                      onClick={() => setActiveStatusMenuId(activeStatusMenuId === order.id ? null : order.id)}
                      className="group/btn focus:outline-none"
                    >
                      {updatingId === order.id ? (
                        <span className="px-3 py-1 rounded-xl text-[11px] font-semibold border border-gray-200 bg-gray-50 text-gray-400 inline-flex items-center gap-1.5 shadow-xs">
                          <RefreshCw className="w-3 h-3 animate-spin text-primary" />
                          updating...
                        </span>
                      ) : (
                        <span className={statusBadge(order.status)}>
                          <span>{order.status}</span>
                          <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${activeStatusMenuId === order.id ? "rotate-90 text-primary" : "rotate-0 text-foreground/40 group-hover/btn:text-foreground"}`} />
                        </span>
                      )}
                    </button>

                    {/* Status Selection Popover */}
                    <AnimatePresence>
                      {activeStatusMenuId === order.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -6 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -6 }}
                          transition={{ duration: 0.15 }}
                          className="absolute right-0 top-full mt-1.5 w-40 bg-white rounded-2xl shadow-xl border border-border/40 py-1.5 z-40 overflow-hidden font-sans"
                        >
                          <div className="px-3 py-1 text-[10px] font-bold text-foreground/40 uppercase tracking-wider border-b border-border/20 mb-1">
                            Select Status
                          </div>
                          {ALL_STATUSES.map((st) => {
                            const isCurrent = (order.status || "").toLowerCase() === st.id;
                            return (
                              <button
                                key={st.id}
                                type="button"
                                onClick={() => updateOrderStatus(order.id, st.id)}
                                className={`w-full px-3 py-1.5 text-left text-xs font-semibold flex items-center justify-between transition-colors ${
                                  isCurrent ? "bg-primary/10 text-primary" : "hover:bg-muted/40 text-foreground/80"
                                }`}
                              >
                                <span className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${st.color}`} />
                                  {st.label}
                                </span>
                                {isCurrent && <Check className="w-3.5 h-3.5 text-primary" strokeWidth={2.5} />}
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }}
                    className="p-2 rounded-lg bg-[#fafaf8] text-foreground/30 group-hover/ord:text-primary group-hover/ord:bg-primary/5 transition-colors"
                    title="View complete order details"
                  >
                    <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
                  </button>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>

      {/* ── Redesigned Record Offline / Manual Order Modal (NO SCROLLBAR) ── */}
      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 15 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[720px] bg-white rounded-3xl shadow-2xl z-50 overflow-hidden flex flex-col border border-border/40 font-sans"
            >
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-border/30 flex items-center justify-between bg-muted/20 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Plus className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">Record Offline / Manual Order</h2>
                    <p className="text-[11px] text-foreground/50">Capture full customer checkout details and sync automatically</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="p-1.5 rounded-xl text-foreground/40 hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Form Content — Compact 2-Column Grid (NO SCROLLBAR) */}
              <form onSubmit={handleCreateOfflineOrder} className="p-5 flex flex-col gap-4">
                
                {/* Section 1: Customer & Address Information (Checkout Fields) */}
                <div className="space-y-2">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-foreground/50 flex items-center gap-1">
                    <User className="w-3 h-3 text-primary" /> Customer & Shipping Info
                  </span>

                  <div className="grid grid-cols-3 gap-2.5 text-xs">
                    <div>
                      <label className="block text-foreground/60 font-semibold text-[11px] mb-1">Full Name *</label>
                      <input
                        type="text"
                        required
                        placeholder="Rahul Sharma"
                        value={manualForm.customerName}
                        onChange={(e) => setManualForm({ ...manualForm, customerName: e.target.value })}
                        className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-foreground/60 font-semibold text-[11px] mb-1">Phone Number</label>
                      <input
                        type="text"
                        placeholder="+91 98765 43210"
                        value={manualForm.customerPhone}
                        onChange={(e) => setManualForm({ ...manualForm, customerPhone: e.target.value })}
                        className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-foreground/60 font-semibold text-[11px] mb-1">Email Address</label>
                      <input
                        type="email"
                        placeholder="customer@example.com"
                        value={manualForm.customerEmail}
                        onChange={(e) => setManualForm({ ...manualForm, customerEmail: e.target.value })}
                        className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                      />
                    </div>

                    <div className="col-span-3 grid grid-cols-4 gap-2">
                      <div className="col-span-2">
                        <input
                          type="text"
                          placeholder="Street Address / Building"
                          value={manualForm.address}
                          onChange={(e) => setManualForm({ ...manualForm, address: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="City"
                          value={manualForm.city}
                          onChange={(e) => setManualForm({ ...manualForm, city: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="State"
                          value={manualForm.state}
                          onChange={(e) => setManualForm({ ...manualForm, state: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                        />
                      </div>
                    </div>

                    <div className="col-span-3 grid grid-cols-2 gap-2">
                      <div>
                        <input
                          type="text"
                          placeholder="Pincode / Postal Code"
                          value={manualForm.zip}
                          onChange={(e) => setManualForm({ ...manualForm, zip: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="Country"
                          value={manualForm.country}
                          onChange={(e) => setManualForm({ ...manualForm, country: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 2: Product & Order Setup */}
                <div className="space-y-2 pt-2 border-t border-border/20">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-foreground/50 flex items-center gap-1">
                    <Package className="w-3 h-3 text-primary" /> Product & Payment Setup
                  </span>

                  {/* Horizontal Compact Product Pills */}
                  <div className="grid grid-cols-3 gap-2">
                    {availableProducts.map((p) => {
                      const isSelected = manualForm.productId === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setManualForm({
                              ...manualForm,
                              productId: p.id,
                              unitPrice: String(p.price),
                            });
                          }}
                          className={`p-2.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                            isSelected
                              ? "bg-primary/10 border-primary shadow-xs ring-1 ring-primary/30"
                              : "bg-white border-border/30 hover:border-primary/30 hover:bg-muted/20"
                          }`}
                        >
                          <div className="min-w-0 pr-1">
                            <p className={`text-xs font-bold truncate ${isSelected ? "text-primary" : "text-foreground"}`}>
                              {p.name}
                            </p>
                            <span className="text-[10px] text-foreground/50 font-medium">₹{p.price.toLocaleString("en-IN")}</span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={3} />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-4 gap-2 pt-1">
                    <div>
                      <label className="block text-foreground/60 font-semibold text-[10px] mb-1">Quantity</label>
                      <input
                        type="number"
                        min="1"
                        value={manualForm.quantity}
                        onChange={(e) => setManualForm({ ...manualForm, quantity: e.target.value })}
                        className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-foreground/60 font-semibold text-[10px] mb-1">Unit Price (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={manualForm.unitPrice}
                        onChange={(e) => setManualForm({ ...manualForm, unitPrice: e.target.value })}
                        className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-foreground/60 font-semibold text-[10px] mb-1">Payment Status</label>
                      <select
                        value={manualForm.paymentStatus}
                        onChange={(e) => setManualForm({ ...manualForm, paymentStatus: e.target.value })}
                        className="w-full h-9 px-2 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                      >
                        <option value="completed">Completed (Paid)</option>
                        <option value="pending">Pending (COD)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-foreground/60 font-semibold text-[10px] mb-1">Order Status</label>
                      <select
                        value={manualForm.orderStatus}
                        onChange={(e) => setManualForm({ ...manualForm, orderStatus: e.target.value })}
                        className="w-full h-9 px-2 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs capitalize"
                      >
                        <option value="delivered">Delivered</option>
                        <option value="shipped">Shipped</option>
                        <option value="packed">Packed</option>
                        <option value="processing">Processing</option>
                        <option value="pending">Pending</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Total & Action Bar */}
                <div className="pt-3 border-t border-border/30 flex items-center justify-between shrink-0">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-foreground/40 block">Total Order Value</span>
                    <span className="text-lg font-black text-primary">
                      ₹{((parseFloat(manualForm.unitPrice) || 0) * (parseInt(manualForm.quantity) || 1)).toLocaleString("en-IN")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddModal(false)}
                      className="px-4 py-2 rounded-xl border border-border/50 text-xs font-semibold text-foreground/60 hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={creatingOrder}
                      className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-md shadow-primary/20 flex items-center gap-2"
                    >
                      {creatingOrder ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save Offline Order
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Order Details Modal Popup ── */}
      <AnimatePresence>
        {selectedOrder && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedOrder(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />

            {/* Centered Modal Container */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[600px] sm:max-h-[90vh] bg-white rounded-3xl shadow-2xl z-50 overflow-hidden flex flex-col border border-border/40 font-sans"
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-border/30 flex items-center justify-between bg-muted/20">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-foreground">
                      Order #{selectedOrder.orderNumber}
                    </h2>
                    <span className={statusBadge(selectedOrder.status)}>
                      {selectedOrder.status}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/40 mt-0.5">Placed on {selectedOrder.date}</p>
                </div>
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="p-2 rounded-xl text-foreground/40 hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-140px)]">

                {/* Customer Information Card */}
                <div className="bg-[#FAF9F5] p-4.5 rounded-2xl border border-border/30 space-y-3">
                  <h3 className="text-xs uppercase tracking-wider font-bold text-foreground/50 flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-primary" />
                    Customer Information
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-foreground/40 font-medium">Name</p>
                      <p className="font-semibold text-foreground mt-0.5">{selectedOrder.customer}</p>
                    </div>

                    {selectedOrder.email && (
                      <div>
                        <p className="text-foreground/40 font-medium flex items-center gap-1">
                          <Mail className="w-3 h-3 text-foreground/30" /> Email
                        </p>
                        <p className="font-medium text-foreground mt-0.5 truncate">{selectedOrder.email}</p>
                      </div>
                    )}

                    {selectedOrder.phone && (
                      <div>
                        <p className="text-foreground/40 font-medium flex items-center gap-1">
                          <Phone className="w-3 h-3 text-foreground/30" /> Phone
                        </p>
                        <p className="font-medium text-foreground mt-0.5">{selectedOrder.phone}</p>
                      </div>
                    )}

                    <div className="sm:col-span-2">
                      <p className="text-foreground/40 font-medium flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-foreground/30" /> Shipping Address
                      </p>
                      <p className="font-medium text-foreground/80 mt-0.5">
                        {selectedOrder.address
                          ? `${selectedOrder.address}, ${selectedOrder.city} ${selectedOrder.state} - ${selectedOrder.zip}, ${selectedOrder.country}`
                          : "Primary Shipping Address"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Items Ordered Breakdown */}
                <div className="space-y-3">
                  <h3 className="text-xs uppercase tracking-wider font-bold text-foreground/50 flex items-center gap-2">
                    <Package className="w-3.5 h-3.5 text-primary" />
                    Ordered Items ({selectedOrder.items} unit{selectedOrder.items !== 1 ? "s" : ""})
                  </h3>

                  <div className="space-y-2">
                    {(selectedOrder.itemsList || []).map((item: any, idx: number) => (
                      <div
                        key={item.id || idx}
                        className="flex items-center justify-between p-3 rounded-xl bg-white border border-border/40 shadow-xs text-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                            {item.quantity}x
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground truncate">{item.name}</p>
                            <p className="text-foreground/40 text-[11px] mt-0.5">
                              Unit Price: ₹{item.unit_price.toLocaleString("en-IN")}
                            </p>
                          </div>
                        </div>

                        <span className="font-bold text-foreground shrink-0 ml-3">
                          ₹{item.total_price.toLocaleString("en-IN")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Financial Summary */}
                <div className="pt-3 border-t border-border/30 flex items-center justify-between text-sm">
                  <span className="font-semibold text-foreground/60">Total Order Amount</span>
                  <span className="text-lg font-bold text-primary">
                    ₹{selectedOrder.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="px-6 py-4 bg-muted/10 border-t border-border/30 flex items-center justify-between">
                <button
                  onClick={() => {
                    const currentIdx = ALL_STATUSES.findIndex((s) => s.id === (selectedOrder.status || "").toLowerCase());
                    const nextStatus = ALL_STATUSES[(currentIdx + 1) % ALL_STATUSES.length].id;
                    updateOrderStatus(selectedOrder.id, nextStatus);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 shadow-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${updatingId === selectedOrder.id ? "animate-spin" : ""}`} />
                  Advance Status
                </button>

                <button
                  onClick={() => setSelectedOrder(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border border-border/50 text-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}


