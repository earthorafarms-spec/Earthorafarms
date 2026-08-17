import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import {
  Cpu, LayoutDashboard, Key, ShieldAlert, LogOut, Terminal, Menu, X, ArrowRight, Activity
} from "lucide-react";

const navItems = [
  { id: "dashboard", label: "API Key Health", icon: Activity, path: "/developer/dashboard", hint: "Monitor and rotate API keys" },
  { id: "website",   label: "Website Details", icon: Key,      path: "/developer/website",   hint: "SEO keywords, keys, & P&L" },
  { id: "passwords", label: "Portal Security", icon: ShieldAlert, path: "/developer/passwords", hint: "Change portal credentials" },
];

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeTab = location.replace("/developer/", "").replace("/developer", "") || "dashboard";

  const handleLogout = () => {
    sessionStorage.removeItem("dev_authenticated");
    window.location.reload();
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-[#0b0f19] text-slate-200 border-r border-slate-800">
      <div className="flex items-center h-20 px-6 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shadow-inner">
            <Cpu className="w-5 h-5 text-indigo-400 animate-pulse" strokeWidth={2} />
          </div>
          <div>
            <span className="font-serif text-lg font-bold tracking-tight text-white block">Earthora</span>
            <span className="text-[10px] text-indigo-400 font-semibold tracking-wider uppercase font-mono">Dev Console</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-6 px-4 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setLocation(item.path);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 relative group text-left ${
                isActive
                  ? "text-white bg-indigo-600/20 border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.15)]"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent"
              }`}
            >
              <item.icon className={`w-[18px] h-[18px] transition-transform duration-300 group-hover:scale-110 ${isActive ? "text-indigo-400" : "text-slate-400"}`} strokeWidth={1.75} />
              <div className="flex-1 min-w-0">
                <span className="block">{item.label}</span>
                <span className="block text-[10px] text-slate-500 font-normal truncate">{item.hint}</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-slate-500" />
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 shrink-0">
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold bg-rose-950/20 text-rose-400 hover:bg-rose-900/30 border border-rose-500/10 hover:border-rose-500/20 transition-all cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Exit Dev Console</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#05070c] text-slate-100 flex font-sans">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-72 shrink-0 h-screen sticky top-0">
        <SidebarContent />
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Top Header */}
        <header className="h-20 border-b border-slate-800 bg-[#070a12]/80 backdrop-blur-md flex items-center justify-between px-6 lg:px-8 sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-xl border border-slate-800 hover:bg-slate-800/50 text-slate-400 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full font-mono text-xs text-indigo-400">
              <Terminal className="w-3.5 h-3.5" />
              <span>env: production</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end text-right">
              <span className="text-xs font-semibold text-slate-300">Developer Root</span>
              <span className="text-[10px] text-slate-500 font-mono">active_session</span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-slate-300 uppercase shadow-inner">
              DV
            </div>
          </div>
        </header>

        {/* Dynamic page content */}
        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto overflow-x-hidden">
          {children}
        </main>
      </div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-xs"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-72 z-50 lg:hidden h-full shadow-2xl"
            >
              <div className="absolute top-5 right-5 z-30">
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 rounded-xl bg-slate-950/40 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
