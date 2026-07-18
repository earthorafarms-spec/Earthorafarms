import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import {
  Activity, ShieldAlert, Terminal, FileText, ArrowRight, Server, Flame, Sparkles
} from "lucide-react";
import { supabase } from "@/lib/supabase";

function MetricCard({ label, value, description, icon: Icon, color, delay }: {
  label: string; value: string; description: string; icon: React.ElementType; color: string; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-card border border-border/50 rounded-2xl p-6 hover:border-primary/30 transition-all duration-300 group shadow-sm hover:shadow"
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-mono font-semibold text-foreground/45 uppercase tracking-wider">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color} border border-border/10 group-hover:scale-110 transition-transform`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-3xl font-mono font-bold text-foreground tracking-tight mb-1">{value}</p>
      <p className="text-xs font-mono text-foreground/40">{description}</p>
    </motion.div>
  );
}

export default function CodexDashboard() {
  const [, setLocation] = useLocation();
  const [metrics, setMetrics] = useState({
    apiCount: "94.2k",
    errorRate: "0.02%",
    pipelineUptime: "100%",
    totalErrors: "14",
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const { count: errorCount } = await (supabase as any)
          .from("codex_logs")
          .select("id", { count: "exact", head: true })
          .eq("event_type", "error");

        const { count: totalLogs } = await (supabase as any)
          .from("codex_logs")
          .select("id", { count: "exact", head: true });

        const rate = totalLogs ? ((errorCount || 0) / totalLogs * 100).toFixed(2) : "0.00";

        setMetrics({
          apiCount: String(totalLogs || 0),
          errorRate: `${rate}%`,
          pipelineUptime: "99.98%",
          totalErrors: String(errorCount || 0),
        });
      } catch (e) {
        console.error("Error loading metrics:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  return (
    <div className="space-y-8 font-mono">
      <div>
        <h1 className="text-2xl font-bold text-foreground font-serif">Developer Dashboard</h1>
        <p className="text-xs text-foreground/45 mt-1">Status monitors and developer console actions</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard
          label="Total Logged Events"
          value={loading ? "..." : metrics.apiCount}
          description="Live events recorded"
          icon={Terminal}
          color="bg-primary/10 text-primary"
          delay={0}
        />
        <MetricCard
          label="Sys Error Rate"
          value={loading ? "..." : metrics.errorRate}
          description="Failure frequency threshold"
          icon={Flame}
          color="bg-red-50 text-red-600"
          delay={0.05}
        />
        <MetricCard
          label="Pipeline Status"
          value={metrics.pipelineUptime}
          description="Visitor analytics pipeline"
          icon={Activity}
          color="bg-green-50 text-green-700"
          delay={0.1}
        />
        <MetricCard
          label="Unresolved Logs"
          value={loading ? "..." : metrics.totalErrors}
          description="Exceptions caught"
          icon={ShieldAlert}
          color="bg-amber-50 text-amber-600"
          delay={0.15}
        />
      </div>

      {/* Navigation Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card border border-border/50 rounded-2xl p-6 flex flex-col justify-between h-48 hover:border-primary/20 transition-all duration-300 shadow-sm"
        >
          <div>
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <h3 className="text-sm font-bold text-foreground mb-1">Developer Analytics</h3>
            <p className="text-xs text-foreground/45 leading-relaxed">
              Track button clicks, visual pipeline graph, API health logs, and exception telemetry.
            </p>
          </div>
          <button
            onClick={() => setLocation("/codex/analytics")}
            className="flex items-center gap-2 text-xs font-semibold text-primary hover:text-primary/80 transition-colors mt-4 self-start"
          >
            Open Analytics <ArrowRight className="w-4.5 h-4.5" />
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-card border border-border/50 rounded-2xl p-6 flex flex-col justify-between h-48 hover:border-primary/20 transition-all duration-300 shadow-sm"
        >
          <div>
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <h3 className="text-sm font-bold text-foreground mb-1">Telemetry Reports</h3>
            <p className="text-xs text-foreground/45 leading-relaxed">
              Aggregate log details by error categories or custom timeframe to compile optimization actions.
            </p>
          </div>
          <button
            onClick={() => setLocation("/codex/reports")}
            className="flex items-center gap-2 text-xs font-semibold text-primary hover:text-primary/80 transition-colors mt-4 self-start"
          >
            Compile Reports <ArrowRight className="w-4.5 h-4.5" />
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-card border border-border/50 rounded-2xl p-6 flex flex-col justify-between h-48 hover:border-primary/20 transition-all duration-300 shadow-sm"
        >
          <div>
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <Server className="w-5 h-5 text-primary" />
            </div>
            <h3 className="text-sm font-bold text-foreground mb-1">Access Configuration</h3>
            <p className="text-xs text-foreground/45 leading-relaxed">
              Update developer access passwords, manage database keys, and set logging thresholds.
            </p>
          </div>
          <button
            onClick={() => setLocation("/codex/settings")}
            className="flex items-center gap-2 text-xs font-semibold text-primary hover:text-primary/80 transition-colors mt-4 self-start"
          >
            Access Settings <ArrowRight className="w-4.5 h-4.5" />
          </button>
        </motion.div>
      </div>
    </div>
  );
}
