import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import {
  BarChart3, FileSpreadsheet, Users, LogOut, Leaf, ChevronRight, Menu, X, ArrowLeft, Package
} from "lucide-react";

const navItems = [
  { id: "dashboard", label: "Selling Overview & Tax", icon: BarChart3, path: "/kacc/dashboard", hint: "Key accounts revenue & GST summary" },
  { id: "b2b-gst", label: "B2B Customers (With GSTIN)", icon: FileSpreadsheet, path: "/kacc/b2b-gst", hint: "GST registered buyers & Excel reports" },
  { id: "b2c-nongst", label: "B2C Retail (No GST)", icon: Users, path: "/kacc/b2c-nongst", hint: "Non-GST consumer sales & Excel reports" },
  { id: "products", label: "Product Margins & Costs", icon: Package, path: "/kacc/products", hint: "Actual cost, selling price & unit profit margin" },
];

export default function KaccLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const userEmail = sessionStorage.getItem("kacc_email") || "keyaccount@earthora.com";

  const handleLogout = () => {
    sessionStorage.removeItem("kacc_authenticated");
    sessionStorage.removeItem("kacc_email");
    sessionStorage.removeItem("kacc_password");
    setLocation("/");
  };

  const activeTab = location.includes("b2b-gst")
    ? "b2b-gst"
    : location.includes("b2c-nongst")
    ? "b2c-nongst"
    : location.includes("products")
    ? "products"
    : "dashboard";

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-foreground flex flex-col font-sans selection:bg-emerald-800 selection:text-white">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-[#0F2318] text-white border-b border-emerald-900/40 shadow-sm">
        <div className="max-w-[1500px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-xl bg-emerald-700 flex items-center justify-center text-white">
                <Leaf className="w-4.5 h-4.5" />
              </div>
              <span className="font-serif font-bold text-lg text-white tracking-tight">Earthora</span>
              <span className="bg-emerald-900/80 border border-emerald-500/30 text-emerald-300 text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold">
                KACC Portal
              </span>
            </Link>
          </div>

          {/* User badge & Actions */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/80">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-emerald-200">{userEmail}</span>
            </div>

            <button
              onClick={handleLogout}
              className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-rose-950/80 hover:text-rose-200 text-white/80 transition-colors text-xs font-medium flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Grid Container */}
      <div className="max-w-[1500px] w-full mx-auto px-4 sm:px-8 py-6 flex-1 flex flex-col lg:flex-row gap-8">
        {/* Sidebar Nav */}
        <aside
          className={`lg:w-64 shrink-0 fixed lg:static inset-y-0 left-0 z-30 w-72 bg-white lg:bg-transparent border-r lg:border-r-0 border-border p-4 lg:p-0 transition-transform duration-300 ${
            mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm space-y-2 sticky top-24">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-black/40 font-mono">
              Key Account Operations
            </div>

            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setLocation(item.path);
                    setMobileOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-medium transition-all text-left group ${
                    isActive
                      ? "bg-[#0F2318] text-white shadow-md font-semibold"
                      : "text-black/70 hover:bg-black/5 hover:text-black"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-emerald-400" : "text-black/40 group-hover:text-black"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{item.label}</p>
                  </div>
                  {isActive && <ChevronRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                </button>
              );
            })}

            <div className="pt-4 mt-4 border-t border-black/5">
              <Link href="/" className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-medium text-black/60 hover:text-black hover:bg-black/5 transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Main Store</span>
              </Link>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
