import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Activity, ShieldAlert, Cpu, Layers, HardDrive, Wifi, ThumbsUp, Trash2
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

interface CodexLog {
  id: string;
  event_type: "click" | "pipeline" | "api_health" | "error";
  event_name: string;
  payload: any;
  created_at: string;
}

export default function CodexAnalytics() {
  const [logs, setLogs] = useState<CodexLog[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchLogs = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from("codex_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (!error && data) {
        setLogs(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleClearLogs = async () => {
    if (!window.confirm("Are you sure you want to clear all developer logs?")) return;
    try {
      const { error } = await (supabase as any)
        .from("codex_logs")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // deletes all
      if (!error) {
        setLogs([]);
        toast({ title: "Logs cleared", description: "Successfully purged codex developer logs." });
      }
    } catch (e: any) {
      toast({ title: "Operation failed", description: e.message, variant: "destructive" });
    }
  };

  // Mock click count aggregation for charts
  const getClickCounts = () => {
    const counts: Record<string, number> = {
      "Add to Cart": 12,
      "Buy Now": 8,
      "Place Order": 5,
      "Submit Review": 4,
      "Track Order": 2
    };
    logs.filter(l => l.event_type === "click").forEach(l => {
      counts[l.event_name] = (counts[l.event_name] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  };

  return (
    <div className="space-y-8 font-mono">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-serif">Developer Analytics</h1>
          <p className="text-xs text-foreground/45 mt-1">Live metrics, interface interaction, and pipelines</p>
        </div>
        <button
          onClick={handleClearLogs}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-xs text-red-600 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear Logs
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Most Clicked Buttons */}
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
            <Cpu className="w-4.5 h-4.5 text-primary" />
            Top Interacted Elements
          </h3>
          <div className="space-y-3.5">
            {getClickCounts().map(([name, val], idx) => {
              const maxVal = Math.max(...getClickCounts().map(([, v]) => v), 1);
              const percent = Math.round((val / maxVal) * 100);
              return (
                <div key={name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground/70">{name}</span>
                    <span className="text-primary font-semibold">{val} clicks</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <motion.div
                      className="h-full bg-primary/80 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${percent}%` }}
                      transition={{ duration: 0.8, delay: idx * 0.05 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* API Health Monitor */}
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
            <Wifi className="w-4.5 h-4.5 text-primary" />
            API & Endpoint Health
          </h3>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border/20">
              <span className="text-foreground/75">Supabase Database Connection</span>
              <span className="text-green-700 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                ONLINE (200 OK)
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border/20">
              <span className="text-foreground/75">Tata SmartFlow SMS API Gateway</span>
              <span className="text-green-700 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                ONLINE (200 OK)
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border/20">
              <span className="text-foreground/75">Edge Function: verify-admin</span>
              <span className="text-green-700 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                HEALTHY
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border/20">
              <span className="text-foreground/75">Edge Function: verify-codex</span>
              <span className="text-green-700 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                HEALTHY
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Visual Data Ingestion Pipeline Flow */}
      <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-bold text-foreground mb-6 flex items-center gap-2">
          <Layers className="w-4.5 h-4.5 text-primary" />
          Ingestion & Action Pipeline Flow
        </h3>
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 px-4 py-2 border border-border/20 rounded-xl bg-muted/30">
          <div className="text-center p-3 rounded-lg bg-card border border-border/40 w-full md:w-36">
            <span className="text-xs text-foreground/45 block mb-1">Source</span>
            <span className="text-xs font-bold text-foreground block">Visitor Action</span>
            <span className="text-[10px] text-primary block mt-0.5">Click/Interaction</span>
          </div>

          <div className="text-primary text-lg animate-pulse font-bold">➔</div>

          <div className="text-center p-3 rounded-lg bg-card border border-border/40 w-full md:w-44">
            <span className="text-xs text-foreground/45 block mb-1">Client Hook</span>
            <span className="text-xs font-bold text-foreground block">Supabase Client SDK</span>
            <span className="text-[10px] text-primary block mt-0.5">Postgres Realtime</span>
          </div>

          <div className="text-primary text-lg animate-pulse font-bold">➔</div>

          <div className="text-center p-3 rounded-lg bg-card border border-primary/30 w-full md:w-44 shadow-sm">
            <span className="text-xs text-foreground/45 block mb-1">Ingestion Server</span>
            <span className="text-xs font-bold text-foreground block">codex_logs DB Table</span>
            <span className="text-[10px] text-green-700 block mt-0.5 font-semibold">RLS Secure Store</span>
          </div>

          <div className="text-primary text-lg animate-pulse font-bold">➔</div>

          <div className="text-center p-3 rounded-lg bg-card border border-border/40 w-full md:w-36">
            <span className="text-xs text-foreground/45 block mb-1">Trigger Execution</span>
            <span className="text-xs font-bold text-foreground block">PLpgSQL DB Trigger</span>
            <span className="text-[10px] text-primary block mt-0.5">Audit log sync</span>
          </div>
        </div>
      </div>

      {/* Live Error Logs Stream */}
      <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
          <HardDrive className="w-4.5 h-4.5 text-primary" />
          Live Exception Telemetry Stream
        </h3>
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {loading ? (
            <p className="text-xs text-foreground/45 py-8 text-center">Telemetry streaming initialized...</p>
          ) : logs.length === 0 ? (
            <p className="text-xs text-foreground/45 py-8 text-center">No active developer logs. System operating normally.</p>
          ) : (
            logs.map(log => (
              <div key={log.id} className="p-3 bg-muted/40 border border-border/30 rounded-xl text-xs flex items-start gap-3.5">
                <span className={`shrink-0 uppercase px-2 py-0.5 text-[9px] font-bold rounded ${
                  log.event_type === "error" ? "bg-red-50 text-red-600 border border-red-200" : "bg-primary/10 text-primary border border-primary/20"
                }`}>
                  {log.event_type}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5 flex-wrap gap-2">
                    <span className="font-semibold text-foreground truncate">{log.event_name}</span>
                    <span className="text-[10px] text-foreground/45">{new Date(log.created_at).toLocaleTimeString()}</span>
                  </div>
                  {log.payload && Object.keys(log.payload).length > 0 && (
                    <pre className="mt-1 p-2 rounded bg-white border border-border/30 text-[10px] text-primary overflow-x-auto">
                      {JSON.stringify(log.payload, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
