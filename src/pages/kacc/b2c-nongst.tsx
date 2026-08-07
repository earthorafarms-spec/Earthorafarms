import { useState, useEffect } from "react";
import {
  Users, Download, Search, RefreshCw, ShoppingCart
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { exportToExcelCSV } from "@/lib/excel-export";

export default function KaccB2CNonGst() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchB2COrders();
  }, []);

  async function fetchB2COrders() {
    setLoading(true);
    try {
      const { data, error } = await (supabase.from("orders") as any)
        .select("*, order_items(id, quantity, unit_price, total_price, product_id, products(id, name))")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setOrders(data || []);
    } catch (err) {
      console.error("Failed to fetch B2C retail orders:", err);
    } finally {
      setLoading(false);
    }
  }

  // Filter ONLY orders WITHOUT GSTIN numbers (B2C Retail Consumers)
  const b2cOrders = orders
    .map((o) => {
      const amount = parseFloat(o.total_amount) || 0;

      // Read flat columns (set at checkout) — no JSON parsing needed
      const gstNo = (o.customer_gst || "").trim();
      const state = (o.customer_state || "").trim();

      const taxableValue = amount / 1.18;
      const taxAmount = amount - taxableValue;

      const isIntraState = !!state && (state.toLowerCase().includes("tamil nadu") || state.toLowerCase() === "tn");
      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      if (isIntraState) {
        cgst = taxAmount / 2;
        sgst = taxAmount / 2;
      } else {
        igst = taxAmount;
      }

      return {
        id: o.id,
        email: o.customer_email || o.user_id || "",
        name: o.customer_name || o.user_id || "Retail Customer",
        phone: o.customer_phone || "",
        gstNo,
        address: o.customer_address || "",
        city: o.customer_city || "",
        state: state || "",
        zip: o.customer_zip || "",
        amount,
        taxableValue,
        cgst,
        sgst,
        igst,
        taxAmount,
        date: new Date(o.created_at || Date.now()).toLocaleDateString("en-IN"),
        rawDate: o.created_at
      };
    })
    .filter((o) => !o.gstNo || o.gstNo.length < 3);

  const filteredB2C = b2cOrders.filter((o) => {
    const term = searchTerm.toLowerCase();
    return (
      o.name.toLowerCase().includes(term) ||
      o.email.toLowerCase().includes(term) ||
      o.state.toLowerCase().includes(term) ||
      String(o.id).toLowerCase().includes(term)
    );
  });

  const handleDownloadExcel = () => {
    const exportRows = filteredB2C.map((item) => ({
      "Order ID": item.id,
      "Order Date": item.date,
      "Customer Name": item.name,
      "Customer Email": item.email,
      "Contact Phone": item.phone,
      "Shipping Address": item.address,
      "City": item.city,
      "State": item.state,
      "Zip Code": item.zip,
      "Taxable Value (₹)": item.taxableValue.toFixed(2),
      "CGST 9% (₹)": item.cgst.toFixed(2),
      "SGST 9% (₹)": item.sgst.toFixed(2),
      "IGST 18% (₹)": item.igst.toFixed(2),
      "Total Order Amount (₹)": item.amount.toFixed(2),
      "Invoice Type": "B2C (Retail Invoice)"
    }));

    exportToExcelCSV("B2C_Retail_Invoices_Report.csv", exportRows);
  };

  const totalB2cVal = filteredB2C.reduce((acc, curr) => acc + curr.amount, 0);
  const totalB2cCgst = filteredB2C.reduce((acc, curr) => acc + curr.cgst, 0);
  const totalB2cSgst = filteredB2C.reduce((acc, curr) => acc + curr.sgst, 0);
  const totalB2cIgst = filteredB2C.reduce((acc, curr) => acc + curr.igst, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-black/5 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-800 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <h1 className="text-2xl font-dm font-bold text-black tracking-tight">B2C Retail Customers (No GST)</h1>
          </div>
          <p className="text-xs text-black/60">
            Retail consumer orders without GST numbers, categorized by state for tax compliance.
          </p>
        </div>

        <button
          onClick={handleDownloadExcel}
          disabled={filteredB2C.length === 0}
          className="px-5 py-3 rounded-xl bg-purple-950 hover:bg-purple-900 text-white text-xs font-semibold flex items-center gap-2 transition-colors shadow-md disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          <span>Export Excel (.CSV) Report</span>
        </button>
      </div>

      {/* Stats Quick Ribbon */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-black/5">
          <span className="text-[10px] text-black/50 uppercase tracking-wider font-mono font-semibold">B2C Consumer Orders</span>
          <p className="text-xl font-bold font-dm text-black mt-1">{filteredB2C.length}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-black/5">
          <span className="text-[10px] text-black/50 uppercase tracking-wider font-mono font-semibold">Total Retail Volume</span>
          <p className="text-xl font-bold font-dm text-black mt-1">₹{totalB2cVal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-black/5">
          <span className="text-[10px] text-black/50 uppercase tracking-wider font-mono font-semibold">Intra-State (CGST+SGST)</span>
          <p className="text-xl font-bold font-dm text-black mt-1">₹{(totalB2cCgst + totalB2cSgst).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-black/5">
          <span className="text-[10px] text-black/50 uppercase tracking-wider font-mono font-semibold">Inter-State (IGST)</span>
          <p className="text-xl font-bold font-dm text-black mt-1">₹{totalB2cIgst.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-black/40 absolute left-3.5 top-3.5" />
        <input
          type="text"
          placeholder="Filter by Customer Name, Email, Order ID or State…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-white border border-black/10 rounded-xl pl-10 pr-4 py-2.5 text-xs text-black placeholder:text-black/40 focus:outline-none focus:border-black/30 transition-colors"
        />
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-3xl border border-black/5 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-inter">
            <thead className="bg-[#FAF9F5] border-b border-black/5 text-black/50 uppercase tracking-wider font-mono">
              <tr>
                <th className="py-3.5 px-6">Order ID</th>
                <th className="py-3.5 px-6">Customer Name</th>
                <th className="py-3.5 px-6">Email / Phone</th>
                <th className="py-3.5 px-6">State</th>
                <th className="py-3.5 px-6 text-right">Taxable Value</th>
                <th className="py-3.5 px-6 text-right">CGST (9%)</th>
                <th className="py-3.5 px-6 text-right">SGST (9%)</th>
                <th className="py-3.5 px-6 text-right">IGST (18%)</th>
                <th className="py-3.5 px-6 text-right">Total Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {filteredB2C.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-black/40 text-xs font-inter">
                    No retail consumer orders found matching search filter.
                  </td>
                </tr>
              ) : (
                filteredB2C.map((row) => (
                  <tr key={row.id} className="hover:bg-black/2 transition-colors">
                    <td className="py-4 px-6 font-mono font-medium text-black">#{String(row.id).slice(0, 8)}</td>
                    <td className="py-4 px-6 font-medium text-black">{row.name}</td>
                    <td className="py-4 px-6 text-black/70">
                      <div>{row.email}</div>
                      {row.phone && <div className="text-[10px] text-black/40">{row.phone}</div>}
                    </td>
                    <td className="py-4 px-6 font-mono text-black/70">{row.state}</td>
                    <td className="py-4 px-6 text-right font-mono text-black/70">₹{row.taxableValue.toFixed(2)}</td>
                    <td className="py-4 px-6 text-right font-mono text-black/70">
                      {row.cgst > 0 ? `₹${row.cgst.toFixed(2)}` : <span className="text-black/30">₹0.00</span>}
                    </td>
                    <td className="py-4 px-6 text-right font-mono text-black/70">
                      {row.sgst > 0 ? `₹${row.sgst.toFixed(2)}` : <span className="text-black/30">₹0.00</span>}
                    </td>
                    <td className="py-4 px-6 text-right font-mono text-black/70">
                      {row.igst > 0 ? `₹${row.igst.toFixed(2)}` : <span className="text-black/30">₹0.00</span>}
                    </td>
                    <td className="py-4 px-6 text-right font-mono font-bold text-black">₹{row.amount.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
