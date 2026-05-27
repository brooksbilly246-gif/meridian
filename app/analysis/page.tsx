"use client";
import { useEffect, useState } from "react";
import { formatAED } from "@/lib/currency";
import { CheckCircle, Lightbulb, TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";

type Stats = {
  balance: string;
  totalPnl: string;
  totalPips: string;
  winRate: string;
  totalTrades: number;
  wins: number;
  losses: number;
  openTrades: number;
};

type Trade = {
  id: number;
  pair: string;
  direction: string;
  pnl: number;
  pnl_pips: number;
  status: string;
  close_time: number;
};

type PnlPoint = { time: string; pnl: number };

type Insight = {
  category: string; label: string;
  trades: number; wins: number; losses: number;
  win_rate: number; avg_pips: number; net_pnl: number;
  rating: string;
  suggestion_key: string | null; suggestion_value: string | null; suggestion_reason: string | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  range_bucket: "Range Size",
  day_of_week:  "Day of Week",
  direction:    "Direction",
  pair:         "Pair",
};

export default function AnalysisPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [pnlHistory, setPnlHistory] = useState<PnlPoint[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  async function loadInsights() {
    const d = await fetch("/api/insights").then((r) => r.json());
    setInsights(d.insights ?? []);
  }

  async function applyInsight(key: string, value: string) {
    setApplying(key);
    await fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    setApplying(null);
    setApplied(key);
    setTimeout(() => setApplied(null), 3000);
    loadInsights();
  }

  useEffect(() => {
    async function load() {
      const [s, t] = await Promise.all([
        fetch("/api/stats").then((r) => r.json()),
        fetch("/api/trades").then((r) => r.json()),
      ]);
      setStats(s.stats);
      setPnlHistory(s.pnlHistory);
      setTrades(t.filter((tr: Trade) => tr.status === "CLOSED"));
    }
    load();
    loadInsights();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, []);

  // P&L by pair
  const byPair: Record<string, { pnl: number; trades: number; wins: number }> = {};
  for (const t of trades) {
    if (!byPair[t.pair]) byPair[t.pair] = { pnl: 0, trades: 0, wins: 0 };
    byPair[t.pair].pnl += t.pnl;
    byPair[t.pair].trades += 1;
    if (t.pnl > 0) byPair[t.pair].wins += 1;
  }
  const pairData = Object.entries(byPair).map(([pair, d]) => ({
    pair,
    pnl: parseFloat(d.pnl.toFixed(2)),
    winRate: parseFloat(((d.wins / d.trades) * 100).toFixed(1)),
  }));

  // P&L by direction
  const long = trades.filter((t) => t.direction === "LONG");
  const short = trades.filter((t) => t.direction === "SHORT");
  const longPnl = long.reduce((s, t) => s + t.pnl, 0);
  const shortPnl = short.reduce((s, t) => s + t.pnl, 0);

  // Win/loss pie
  const pie = [
    { name: "Wins", value: stats?.wins ?? 0 },
    { name: "Losses", value: stats?.losses ?? 0 },
  ];

  // Per-trade bar
  const perTradeBar = trades.slice(-30).map((t, i) => ({
    n: i + 1,
    pnl: parseFloat(t.pnl.toFixed(2)),
  }));

  const tooltip = {
    contentStyle: {
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      color: "var(--text-primary)",
      fontSize: 12,
    },
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Analysis
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
          Performance breakdown across all paper trades
        </p>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "Total Trades", value: stats?.totalTrades ?? 0, color: "var(--accent)" },
          { label: "Win Rate", value: `${stats?.winRate ?? 0}%`, color: "var(--green)" },
          { label: "Total Pips", value: `${stats?.totalPips ?? 0}`, color: "var(--yellow)" },
          { label: "Net P&L", value: formatAED(parseFloat(stats?.totalPnl ?? "0"), { sign: true }), color: parseFloat(stats?.totalPnl ?? "0") >= 0 ? "var(--green)" : "var(--red)" },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass rounded-2xl p-4">
            <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
              {label}
            </div>
            <div className="text-2xl font-bold" style={{ color }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Equity curve */}
        <div className="xl:col-span-2 glass rounded-2xl p-5">
          <div className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
            Equity Curve
          </div>
          {pnlHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={pnlHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
                <Tooltip {...tooltip} formatter={(v: unknown) => [formatAED(v as number), "P&L"]} />
                <Line type="monotone" dataKey="pnl" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty label="Close more trades to see the equity curve" />
          )}
        </div>

        {/* Win/loss pie */}
        <div className="glass rounded-2xl p-5 flex flex-col items-center justify-center">
          <div className="text-sm font-semibold mb-4 self-start" style={{ color: "var(--text-primary)" }}>
            Win / Loss Split
          </div>
          {(stats?.totalTrades ?? 0) > 0 ? (
            <>
              <PieChart width={160} height={160}>
                <Pie
                  data={pie}
                  cx={75}
                  cy={75}
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={3}
                  dataKey="value"
                >
                  <Cell fill="var(--green)" />
                  <Cell fill="var(--red)" />
                </Pie>
              </PieChart>
              <div className="flex gap-4 mt-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--green)" }} />
                  <span style={{ color: "var(--text-muted)" }}>Wins {stats?.wins}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--red)" }} />
                  <span style={{ color: "var(--text-muted)" }}>Losses {stats?.losses}</span>
                </div>
              </div>
            </>
          ) : (
            <Empty label="No closed trades yet" />
          )}
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* P&L by pair */}
        <div className="glass rounded-2xl p-5">
          <div className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
            P&L by Pair
          </div>
          {pairData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={pairData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="pair" tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
                <Tooltip {...tooltip} formatter={(v: unknown) => [formatAED(v as number), "P&L"]} />
                <Bar
                  dataKey="pnl"
                  radius={[4, 4, 0, 0]}
                  fill="var(--accent)"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty label="No pair data yet" />
          )}
        </div>

        {/* Per-trade P&L */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Per-Trade P&L (last 30)
            </span>
          </div>
          {perTradeBar.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={perTradeBar}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="n" tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
                <Tooltip {...tooltip} formatter={(v: unknown) => [formatAED(v as number), "P&L"]} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {perTradeBar.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.pnl >= 0 ? "var(--green)" : "var(--red)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty label="No closed trades yet" />
          )}
        </div>
      </div>

      {/* Long vs Short */}
      <div className="glass rounded-2xl p-5">
        <div className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          Long vs Short Performance
        </div>
        <div className="grid grid-cols-2 gap-4">
          <PerfBox
            label="LONG"
            trades={long.length}
            wins={long.filter((t) => t.pnl > 0).length}
            pnl={longPnl}
            color="var(--green)"
          />
          <PerfBox
            label="SHORT"
            trades={short.length}
            wins={short.filter((t) => t.pnl > 0).length}
            pnl={shortPnl}
            color="var(--red)"
          />
        </div>
      </div>

      {/* Strategy Insights */}
      <div className="glass rounded-2xl p-5 space-y-5">
        <div className="flex items-center justify-between pb-1" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Strategy Insights
            </div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {insights.length > 0
                ? `Pattern analysis across ${stats?.totalTrades ?? 0} closed trades — suggestions apply settings automatically`
                : "Close 3+ trades for pattern analysis to begin"}
            </div>
          </div>
          <button
            onClick={loadInsights}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all hover:opacity-70"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>

        {insights.length === 0 ? (
          <div
            className="flex items-center justify-center h-24 rounded-xl text-sm"
            style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border)" }}
          >
            <Lightbulb size={16} className="mr-2" style={{ color: "var(--accent)" }} />
            Insights will appear here once trades have closed
          </div>
        ) : (
          Object.keys(CATEGORY_LABELS).map((cat) => {
            const group = insights.filter((i) => i.category === cat);
            if (!group.length) return null;
            return (
              <div key={cat}>
                <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-muted)" }}>
                  {CATEGORY_LABELS[cat]}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {group.map((ins) => (
                    <InsightCard
                      key={ins.label}
                      ins={ins}
                      applying={applying === ins.suggestion_key}
                      applied={applied === ins.suggestion_key}
                      onApply={applyInsight}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PerfBox({
  label,
  trades,
  wins,
  pnl,
  color,
}: {
  label: string;
  trades: number;
  wins: number;
  pnl: number;
  color: string;
}) {
  const wr = trades > 0 ? ((wins / trades) * 100).toFixed(1) : "0.0";
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: `${color}08`, border: `1px solid ${color}25` }}
    >
      <div className="text-xs font-bold tracking-widest mb-3" style={{ color }}>
        {label}
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span style={{ color: "var(--text-muted)" }}>Trades</span>
          <span style={{ color: "var(--text-primary)" }}>{trades}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "var(--text-muted)" }}>Win Rate</span>
          <span style={{ color }}>{wr}%</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "var(--text-muted)" }}>Net P&L</span>
          <span style={{ color: pnl >= 0 ? "var(--green)" : "var(--red)" }}>
            {formatAED(pnl, { sign: true })}
          </span>
        </div>
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div
      className="h-[200px] flex items-center justify-center text-sm rounded-xl"
      style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border)" }}
    >
      {label}
    </div>
  );
}

const RATING_META: Record<string, { color: string; bg: string; label: string }> = {
  STRONG_EDGE:  { color: "var(--green)",        bg: "rgba(0,255,136,0.1)",    label: "Strong Edge" },
  OK:           { color: "var(--accent)",        bg: "rgba(0,212,255,0.08)",   label: "OK" },
  AVOID:        { color: "var(--red)",           bg: "rgba(255,51,102,0.1)",   label: "Avoid" },
  INSUFFICIENT: { color: "var(--text-muted)",   bg: "rgba(255,255,255,0.03)", label: "Insufficient data" },
};

function InsightCard({
  ins, applying, applied, onApply,
}: {
  ins: {
    label: string; trades: number; wins: number; losses: number;
    win_rate: number; avg_pips: number; net_pnl: number; rating: string;
    suggestion_key: string | null; suggestion_value: string | null; suggestion_reason: string | null;
  };
  applying: boolean; applied: boolean;
  onApply: (key: string, value: string) => void;
}) {
  const meta = RATING_META[ins.rating] ?? RATING_META.INSUFFICIENT;
  const wr = (ins.win_rate * 100).toFixed(0);
  const hasSuggestion = ins.suggestion_key && ins.suggestion_value;

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: meta.bg, border: `1px solid ${meta.color}25` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{ins.label}</span>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: `${meta.color}20`, color: meta.color }}
        >
          {meta.label}
        </span>
      </div>

      {/* Stats */}
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span style={{ color: "var(--text-muted)" }}>Win Rate</span>
          <span className="font-semibold" style={{ color: meta.color }}>{wr}%</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "var(--text-muted)" }}>Trades</span>
          <span style={{ color: "var(--text-primary)" }}>{ins.wins}W / {ins.losses}L ({ins.trades})</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "var(--text-muted)" }}>Avg Pips</span>
          <span style={{ color: ins.avg_pips >= 0 ? "var(--green)" : "var(--red)" }}>
            {ins.avg_pips >= 0 ? "+" : ""}{ins.avg_pips.toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "var(--text-muted)" }}>Net P&L</span>
          <span style={{ color: ins.net_pnl >= 0 ? "var(--green)" : "var(--red)" }}>
            {formatAED(ins.net_pnl, { sign: true })}
          </span>
        </div>
      </div>

      {/* Suggestion */}
      {hasSuggestion && (
        <div
          className="rounded-lg p-2.5 space-y-2 text-xs"
          style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-start gap-1.5">
            <Lightbulb size={11} className="shrink-0 mt-0.5" style={{ color: "var(--yellow)" }} />
            <span style={{ color: "var(--text-muted)" }}>{ins.suggestion_reason}</span>
          </div>
          <button
            onClick={() => onApply(ins.suggestion_key!, ins.suggestion_value!)}
            disabled={applying || applied}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-semibold transition-all hover:opacity-90 active:scale-95 disabled:opacity-60 text-[11px]"
            style={{
              background: applied ? "rgba(0,255,136,0.15)" : "rgba(0,212,255,0.15)",
              border: `1px solid ${applied ? "rgba(0,255,136,0.3)" : "rgba(0,212,255,0.3)"}`,
              color: applied ? "var(--green)" : "var(--accent)",
            }}
          >
            {applied
              ? <><CheckCircle size={11} /> Applied</>
              : applying
              ? "Applying…"
              : <>Apply suggestion</>}
          </button>
        </div>
      )}
    </div>
  );
}
