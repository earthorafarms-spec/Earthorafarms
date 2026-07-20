import { useState, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import {
  LayoutDashboard, Activity, FileText, Settings, LogOut, Terminal, Code2, Menu, X, MessageSquare
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const navItems = [
  { id: "dashboard", label: "Dashboard",   icon: LayoutDashboard, path: "/codex/dashboard" },
  { id: "analytics", label: "Analytics",   icon: Activity,        path: "/codex/analytics" },
  { id: "reports",   label: "Reports",     icon: FileText,        path: "/codex/reports" },
  { id: "settings",  label: "Settings",    icon: Settings,        path: "/codex/settings" },
];

export default function CodexLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { toast } = useToast();

  const activeTab = location.replace("/codex/", "").replace("/codex", "") || "dashboard";

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-primary text-primary-foreground">
      <div className="flex items-center h-20 px-6 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shadow-inner">
            <Terminal className="w-5 h-5 text-accent" strokeWidth={2} />
          </div>
          <div>
            <span className="font-mono text-lg font-bold tracking-tight text-white block">Codex</span>
            <span className="text-[9px] font-mono text-white/40 font-semibold tracking-wider uppercase">Developer Core</span>
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
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 relative group font-mono ${
                isActive
                  ? "text-primary bg-[#fafaf8] shadow-md"
                  : "text-white/70 hover:text-white hover:bg-white/5"
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="activeBarCodex"
                  className="absolute left-0 top-1/4 bottom-1/4 w-1 rounded-r-full bg-primary"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <item.icon className={`w-[18px] h-[18px] transition-transform duration-300 group-hover:scale-110 ${isActive ? "text-primary" : "text-white/60"}`} strokeWidth={1.75} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10 bg-black/10">
        <div className="flex items-center gap-3 px-3 py-2.5 mb-2 rounded-xl bg-white/5 border border-white/5">
          <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-xs font-mono font-bold text-primary">
            D
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-mono font-medium text-white truncate">Dev Console</p>
            <p className="text-[10px] font-mono text-white/40 truncate">developer@earthora.com</p>
          </div>
        </div>
        <button
          onClick={() => {
            sessionStorage.removeItem("codex_authenticated");
            sessionStorage.removeItem("codex_password");
            toast({ title: "Session terminated", description: "Logged out from Codex console." });
            setLocation("/");
          }}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-mono font-medium text-white/60 hover:text-white hover:bg-white/5 transition-all"
        >
          <LogOut className="w-[17px] h-[17px] text-white/40" strokeWidth={1.75} />
          <span>Exit Codex</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-screen w-screen flex bg-[#fafaf8] text-foreground selection:bg-primary/20 overflow-hidden">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:block w-64 shrink-0 h-full">
        <SidebarContent />
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Header - Mobile & Desktop Actions */}
        <header className="h-20 border-b border-border/40 bg-white flex items-center justify-between px-6 lg:px-8 shrink-0">
          <div className="flex items-center gap-4 lg:hidden">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 -ml-2 rounded-xl hover:bg-muted transition-colors text-foreground"
            >
              <Menu className="w-6 h-6" strokeWidth={1.5} />
            </button>
            <div className="flex items-center gap-2">
              <Code2 className="w-5 h-5 text-primary" />
              <span className="font-mono text-sm font-bold text-foreground uppercase tracking-wider">Codex</span>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-2 text-xs font-mono text-foreground/45">
            <span className="text-primary font-semibold">SYSTEM: ONLINE</span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setLocation("/")}
              className="px-3.5 py-1.5 rounded-lg border border-border/60 bg-white hover:bg-muted text-xs font-mono font-medium text-foreground/75 hover:text-foreground transition-all"
            >
              Storefront
            </button>
          </div>
        </header>

        {/* Main Content Window */}
        <main className="flex-1 overflow-hidden p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <Suspense fallback={
              <div className="flex min-h-[50dvh] items-center justify-center">
                <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              </div>
            }>
              {children}
            </Suspense>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile Drawer Backdrop & Sidebar */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black z-40 lg:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 bottom-0 left-0 w-64 z-50 lg:hidden"
            >
              <SidebarContent />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
