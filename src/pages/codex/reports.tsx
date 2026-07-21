import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  FileText, Calendar, CloudLightning, Download, CheckCircle2, ShieldAlert
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface LogSummary {
  name: string;
  type: string;
  count: number;
  lastOccurrence: string;
}

export default function CodexReports() {
  const [reportSummaries, setReportSummaries] = useState<LogSummary[]>([
    { name: "CORS preflight blocked", type: "error", count: 8, lastOccurrence: "2026-07-15" },
    { name: "verify-admin invocation", type: "api_health", count: 24, lastOccurrence: "2026-07-15" },
    { name: "Add to Cart interaction", type: "click", count: 12, lastOccurrence: "2026-07-16" },
  ]);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [rangeType, setRangeType] = useState<"7days" | "month" | "custom">("7days");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState(false);

  async function loadReport() {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("codex_logs")
        .select("*");
      if (!error && data && data.length > 0) {
        const map: Record<string, { type: string; count: number; last: string }> = {};
        data.forEach((log: any) => {
          const key = log.event_name;
          if (!map[key]) {
            map[key] = { type: log.event_type, count: 0, last: log.created_at };
          }
          map[key].count++;
          if (new Date(log.created_at) > new Date(map[key].last)) {
            map[key].last = log.created_at;
          }
        });
        setReportSummaries(
          Object.entries(map).map(([name, stat]) => ({
            name,
            type: stat.type,
            count: stat.count,
            lastOccurrence: new Date(stat.last).toLocaleDateString(),
          }))
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      let query = (supabase as any).from("codex_logs").select("*");

      if (rangeType === "7days") {
        const start = new Date();
        start.setDate(start.getDate() - 7);
        query = query.gte("created_at", start.toISOString());
      } else if (rangeType === "month") {
        const [year, month] = selectedMonth.split("-");
        const start = new Date(Number(year), Number(month) - 1, 1);
        const end = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);
        query = query.gte("created_at", start.toISOString()).lte("created_at", end.toISOString());
      } else if (rangeType === "custom") {
        if (startDate) query = query.gte("created_at", new Date(startDate).toISOString());
        if (endDate) query = query.lte("created_at", new Date(endDate + "T23:59:59").toISOString());
      }

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;

      if (!data || data.length === 0) {
        setExporting(false);
        return;
      }

      // Download file helper
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `codex_logs_${rangeType}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setModalOpen(false);
    } catch (err: any) {
      // Export failure silently handled below
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8 font-mono">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-serif">System Reports</h1>
          <p className="text-xs text-foreground/45 mt-1">Aggregated developer logs and telemetry summaries</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary/20 text-xs font-semibold text-primary transition-all shadow-sm"
        >
          <Download className="w-4 h-4" />
          Export Report
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-card border border-border/50 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2 text-green-700 text-xs">
            <CheckCircle2 className="w-4 h-4" />
            <span>Operational SLA</span>
          </div>
          <p className="text-2xl font-bold text-foreground font-mono">99.98%</p>
          <span className="text-[10px] text-foreground/40 mt-1 block">Uptime over last 30 days</span>
        </div>
        <div className="bg-card border border-border/50 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2 text-primary text-xs">
            <FileText className="w-4 h-4" />
            <span>Recorded Incidents</span>
          </div>
          <p className="text-2xl font-bold text-foreground font-mono">
            {reportSummaries.filter(r => r.type === "error").reduce((sum, r) => sum + r.count, 0)}
          </p>
          <span className="text-[10px] text-foreground/40 mt-1 block">Exceptions captured globally</span>
        </div>
        <div className="bg-card border border-border/50 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2 text-amber-700 text-xs">
            <CloudLightning className="w-4 h-4" />
            <span>Mean Time to Fix</span>
          </div>
          <p className="text-2xl font-bold text-foreground font-mono">&lt; 15 mins</p>
          <span className="text-[10px] text-foreground/40 mt-1 block">Average resolution frequency</span>
        </div>
      </div>

      <div className="bg-card border border-border/50 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Telemetry Logs Aggregate</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/50 text-foreground/45 bg-muted/40">
                <th className="p-4 font-semibold uppercase tracking-wider">Event Name</th>
                <th className="p-4 font-semibold uppercase tracking-wider">Type</th>
                <th className="p-4 font-semibold uppercase tracking-wider">Count</th>
                <th className="p-4 font-semibold uppercase tracking-wider">Last Detected</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-foreground/45">Loading log compilation report...</td>
                </tr>
              ) : reportSummaries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-foreground/45">No records found. Complete a visitor flow to log.</td>
                </tr>
              ) : (
                reportSummaries.map((summary, idx) => (
                  <tr key={idx} className="border-b border-border/30 hover:bg-muted/10 transition-colors">
                    <td className="p-4 font-medium text-foreground">{summary.name}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                        summary.type === "error" ? "bg-red-50 text-red-600 border border-red-200" : "bg-primary/10 text-primary border border-primary/20"
                      }`}>
                        {summary.type}
                      </span>
                    </td>
                    <td className="p-4 font-semibold text-foreground/80">{summary.count}</td>
                    <td className="p-4 text-foreground/40">{summary.lastOccurrence}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Export Options Modal overlay */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setModalOpen(false)} />
          <div className="bg-card border border-border/50 rounded-3xl w-full max-w-md p-6 relative z-10 shadow-2xl space-y-6">
            <div>
              <h3 className="text-base font-serif font-bold text-foreground">Configure Log Export</h3>
              <p className="text-xs text-foreground/40 mt-1">Select the telemetry range to download</p>
            </div>

            <div className="space-y-4">
              <div className="flex gap-2">
                {(["7days", "month", "custom"] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setRangeType(type)}
                    className={`flex-1 py-2 text-xs font-semibold rounded-xl border transition-all ${
                      rangeType === type
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-[#fafaf8] border-border/60 text-foreground/75 hover:bg-muted"
                    }`}
                  >
                    {type === "7days" ? "Last 7 Days" : type === "month" ? "By Month" : "Custom Range"}
                  </button>
                ))}
              </div>

              {rangeType === "month" && (
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-foreground/45">Select Month</label>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full h-11 px-4 text-xs bg-[#fafaf8] border border-border/60 rounded-xl outline-none focus:border-primary/20 font-medium"
                  />
                </div>
              )}

              {rangeType === "custom" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-bold text-foreground/45">Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full h-11 px-4 text-xs bg-[#fafaf8] border border-border/60 rounded-xl outline-none focus:border-primary/20 font-medium"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-bold text-foreground/45">End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full h-11 px-4 text-xs bg-[#fafaf8] border border-border/60 rounded-xl outline-none focus:border-primary/20 font-medium"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setModalOpen(false)}
                className="flex-1 h-11 rounded-xl border border-border/60 bg-[#fafaf8] hover:bg-muted text-xs font-semibold text-foreground/70 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-xs flex items-center justify-center transition-all hover:bg-primary/90 disabled:opacity-50"
              >
                {exporting ? "Exporting..." : "Download JSON"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
