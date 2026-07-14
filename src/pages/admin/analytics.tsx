import { useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp, Users, Eye, Clock, Search, ArrowUpRight, ArrowDownRight,
  Globe, Monitor, Smartphone, Tablet, ChevronRight, Calendar
} from "lucide-react";

const timeframeOptions = ["Last 7 days", "Last 30 days", "Last 90 days", "This Year"];

const overviewData = {
  totalVisitors: 8472,
  pageViews: 28456,
  bounceRate: 32.4,
  avgSessionDuration: "4m 32s",
  visitorTrend: "+12.3%",
  pageViewTrend: "+8.7%",
  bounceTrend: "-2.1%",
  sessionTrend: "+5.8%",
};

const topKeywords = [
  { keyword: "moringa capsules benefits", clicks: 1248, position: 2.3, trend: "+18%" },
  { keyword: "organic moringa powder", clicks: 987, position: 3.1, trend: "+12%" },
  { keyword: "moringa for immunity", clicks: 876, position: 1.8, trend: "+24%" },
  { keyword: "amla powder organic", clicks: 654, position: 4.2, trend: "+8%" },
  { keyword: "best moringa supplements", clicks: 543, position: 2.9, trend: "+15%" },
  { keyword: "moringa tablets india", clicks: 432, position: 5.1, trend: "+6%" },
  { keyword: "earthora farms", clicks: 398, position: 1.0, trend: "+32%" },
  { keyword: "moringa for hair growth", clicks: 312, position: 3.8, trend: "+11%" },
];

const userFrequency = [
  { label: "New Visitors", value: 58, color: "bg-accent" },
  { label: "Returning Visitors", value: 32, color: "bg-primary" },
  { label: "One-time Visitors", value: 10, color: "bg-muted-foreground/30" },
];

const trafficSources = [
  { source: "Organic Search", percentage: 42, icon: Search, color: "bg-primary" },
  { source: "Direct", percentage: 28, icon: Globe, color: "bg-accent" },
  { source: "Social Media", percentage: 18, icon: Users, color: "bg-blue-500" },
  { source: "Referral", percentage: 12, icon: ArrowUpRight, color: "bg-green-500" },
];

const devices = [
  { name: "Desktop", percentage: 45, icon: Monitor, color: "bg-primary" },
  { name: "Mobile", percentage: 42, icon: Smartphone, color: "bg-accent" },
  { name: "Tablet", percentage: 13, icon: Tablet, color: "bg-blue-400" },
];

const monthlyViews = [
  { month: "Feb", views: 12400 },
  { month: "Mar", views: 15300 },
  { month: "Apr", views: 14200 },
  { month: "May", views: 18100 },
  { month: "Jun", views: 22400 },
  { month: "Jul", views: 25600 },
];

function StatCard({ label, value, icon: Icon, trend, isPositive }: { label: string; value: string; icon: React.ElementType; trend: string; isPositive: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="group bg-card rounded-2xl border border-border/50 p-6 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:border-primary/20 transition-all duration-500"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-12 h-12 rounded-xl bg-primary/8 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
          <Icon className="w-5 h-5 text-primary" strokeWidth={1.5} />
        </div>
        <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${isPositive ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
          {isPositive ? <ArrowUpRight className="w-3 h-3" strokeWidth={2} /> : <ArrowDownRight className="w-3 h-3" strokeWidth={2} />}
          {trend}
        </span>
      </div>
      <p className="text-3xl font-bold text-foreground tracking-tight mb-0.5">{value}</p>
      <p className="text-sm text-foreground/50 font-medium">{label}</p>
    </motion.div>
  );
}

export default function AdminAnalytics() {
  const [timeframe, setTimeframe] = useState("Last 30 days");
  const [timeframeOpen, setTimeframeOpen] = useState(false);

  const maxViews = Math.max(...monthlyViews.map((m) => m.views));

  return (
    <motion.div
      key="analytics"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-lg font-serif font-bold text-foreground">Analytics Overview</h2>
          <p className="text-xs text-foreground/40 mt-0.5">Track your website performance and traffic patterns</p>
        </div>
        <div className="relative">
          <button
            onClick={() => setTimeframeOpen(!timeframeOpen)}
            className="flex items-center gap-2 bg-white border border-border/40 rounded-xl px-4 py-2.5 text-sm text-foreground/70 hover:border-primary/30 transition-all"
          >
            <Calendar className="w-4 h-4 text-foreground/40" strokeWidth={1.5} />
            {timeframe}
            <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${timeframeOpen ? "rotate-90" : ""}`} strokeWidth={1.5} />
          </button>
          {timeframeOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setTimeframeOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 w-44 bg-white rounded-xl border border-border/40 shadow-lg z-20 overflow-hidden">
                {timeframeOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => { setTimeframe(opt); setTimeframeOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-muted/50 ${
                      timeframe === opt ? "text-primary font-semibold bg-primary/5" : "text-foreground/60"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard label="Total Visitors" value={overviewData.totalVisitors.toLocaleString()} icon={Users} trend={overviewData.visitorTrend} isPositive={true} />
        <StatCard label="Page Views" value={overviewData.pageViews.toLocaleString()} icon={Eye} trend={overviewData.pageViewTrend} isPositive={true} />
        <StatCard label="Bounce Rate" value={`${overviewData.bounceRate}%`} icon={TrendingUp} trend={overviewData.bounceTrend} isPositive={false} />
        <StatCard label="Avg. Session" value={overviewData.avgSessionDuration} icon={Clock} trend={overviewData.sessionTrend} isPositive={true} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-border/40 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-6 py-5 border-b border-border/20">
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <h2 className="text-sm font-serif font-bold text-foreground">Page Views Over Time</h2>
            </div>
            <span className="text-xs text-foreground/40">Last 6 months</span>
          </div>
          <div className="p-6">
            <div className="flex items-end justify-between gap-3 h-48">
              {monthlyViews.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                  <span className="text-[10px] text-foreground/40 font-medium">{m.views >= 1000 ? `${(m.views / 1000).toFixed(1)}k` : m.views}</span>
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${(m.views / maxViews) * 100}%` }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full max-w-[48px] rounded-lg bg-gradient-to-t from-primary/60 to-primary/30 hover:from-primary hover:to-primary/50 transition-colors cursor-pointer relative group/bar"
                  >
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-primary-foreground text-[10px] px-2 py-1 rounded-lg opacity-0 group-hover/bar:opacity-100 transition-opacity whitespace-nowrap shadow-lg">
                      {m.views.toLocaleString()} views
                    </div>
                  </motion.div>
                  <span className="text-[11px] text-foreground/50 font-medium mt-1">{m.month}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-border/40 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-2.5 h-2.5 rounded-full bg-accent" />
            <h2 className="text-sm font-serif font-bold text-foreground">Traffic Sources</h2>
          </div>
          <div className="space-y-5">
            {trafficSources.map((source) => (
              <div key={source.source} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${source.color}/10`}>
                      <source.icon className={`w-3.5 h-3.5 ${source.color.replace("bg-", "text-")}`} strokeWidth={1.5} />
                    </div>
                    <span className="text-foreground/70 text-xs font-medium">{source.source}</span>
                  </div>
                  <span className="text-xs font-bold text-foreground">{source.percentage}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-border/40 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${source.percentage}%` }}
                    transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                    className={`h-full rounded-full ${source.color}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-2xl border border-border/40 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-6 py-5 border-b border-border/20">
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <h2 className="text-sm font-serif font-bold text-foreground">Top Search Keywords</h2>
            </div>
            <span className="text-xs text-foreground/40">By clicks</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/10">
                  {["Keyword", "Clicks", "Avg. Position", "Trend"].map((h) => (
                    <th key={h} className="text-left py-3.5 px-5 text-[11px] text-foreground/25 font-semibold uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topKeywords.map((kw, i) => (
                  <motion.tr
                    key={kw.keyword}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.04 }}
                    className="border-b border-border/8 hover:bg-muted/30 transition-colors"
                  >
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] font-bold text-foreground/20 w-5">{i + 1}</span>
                        <span className="text-xs text-foreground font-medium">{kw.keyword}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-5 text-xs font-semibold text-foreground">{kw.clicks.toLocaleString()}</td>
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{kw.position.toFixed(1)}</span>
                        <div className="w-16 h-1.5 rounded-full bg-border/40 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.max(5, (1 / kw.position) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-5">
                      <span className="text-[11px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-lg">{kw.trend}</span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-border/40 p-6 shadow-sm">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-2.5 h-2.5 rounded-full bg-accent" />
              <h2 className="text-sm font-serif font-bold text-foreground">Visitor Frequency</h2>
            </div>
            <div className="space-y-4">
              {userFrequency.map((item) => (
                <div key={item.label} className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-xs text-foreground/70">{item.label}</span>
                    <span className="text-xs font-bold text-foreground">{item.value}%</span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-border/40 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${item.value}%` }}
                      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                      className={`h-full rounded-full ${item.color}`}
                    />
                  </div>
                </div>
              ))}
              <div className="pt-3 border-t border-border/10">
                <p className="text-[11px] text-foreground/40 leading-relaxed">
                  <span className="font-semibold text-foreground/70">58% new visitors</span> suggest strong organic discovery. Returning visitors at <span className="font-semibold text-foreground/70">32%</span> indicates healthy retention and repeat engagement with your content.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-border/40 p-6 shadow-sm">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <h2 className="text-sm font-serif font-bold text-foreground">Device Breakdown</h2>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {devices.map((device) => (
                <div key={device.name} className="text-center">
                  <div className={`w-12 h-12 rounded-xl ${device.color}/10 flex items-center justify-center mx-auto mb-2`}>
                    <device.icon className={`w-5 h-5 ${device.color.replace("bg-", "text-")}`} strokeWidth={1.5} />
                  </div>
                  <p className="text-lg font-bold text-foreground">{device.percentage}%</p>
                  <p className="text-[11px] text-foreground/40 font-medium">{device.name}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
