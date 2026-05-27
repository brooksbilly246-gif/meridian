"use client";
import { useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Landmark,
  Activity,
  Target,
  Clock,
  Wifi,
} from "lucide-react";
import { formatAED } from "@/lib/currency";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
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
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  pnl: number;
  status: string;
  open_time: number;
};

type PnlPoint = { time: string; pnl: number };

const PAIRS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD"];

const mockPrices: Record<string, number> = {
  "EUR/USD": 1.0845,
  "GBP/USD": 1.2731,
  "USD/JPY": 157.42,
  "AUD/USD": 0.6523,
  "USD/CAD": 1.3611,
};

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [pnlHistory, setPnlHistory] = useState<PnlPoint[]>([]);
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [prices, setPrices] = useState(mockPrices);

  async function fetchData() {
    const [s, t] = await Promise.all([
      fetch("/api/stats").then((r) => r.json()),
      fetch("/api/trades?type=open").then((r) => r.json()),
    ]);
    setStats(s.stats);
    setPnlHistory(s.pnlHistory);
    setOpenTrades(t);
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  // Simulate small price ticks
  useEffect(() => {
    const tick = setInterval(() => {
      setPrices((prev) => {
        const next = { ...prev };
        for (const pair of PAIRS) {
          const drift = (Math.random() - 0.5) * 0.0003;
          next[pair] = parseFloat((prev[pair] + drift).toFixed(5));
        }
        return next;
      });
    }, 2000);
    return () => clearInterval(tick);
  }, []);

  const pnl = parseFloat(stats?.totalPnl ?? "0");
  const pnlPositive = pnl >= 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Dashboard
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            Paper trading active · Auto-refreshing
          </p>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
          style={{ background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)", color: "var(--accent)" }}
        >
          <Wifi size={12} />
          LIVE
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Paper Balance"
          value={formatAED(parseFloat(stats?.balance ?? "10000"))}
          icon={<Landmark size={16} />}
          accent="var(--accent)"
        />
        <StatCard
          label="Total P&L"
          value={formatAED(pnl, { sign: true })}
          sub={`${stats?.totalPips ?? "0"} pips`}
          icon={pnlPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          accent={pnlPositive ? "var(--green)" : "var(--red)"}
        />
        <StatCard
          label="Win Rate"
          value={`${stats?.winRate ?? "0"}%`}
          sub={`${stats?.wins ?? 0}W / ${stats?.losses ?? 0}L`}
          icon={<Target size={16} />}
          accent="var(--yellow)"
        />
        <StatCard
          label="Open Trades"
          value={String(stats?.openTrades ?? 0)}
          sub={`${stats?.totalTrades ?? 0} total closed`}
          icon={<Activity size={16} />}
          accent="var(--accent)"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Equity curve */}
        <div className="xl:col-span-2 glass rounded-2xl p-5 glow-accent">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Equity Curve
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Cumulative P&L
            </span>
          </div>
          {pnlHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={pnlHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 12,
                  }}
                  formatter={(v: unknown) => [formatAED(v as number), "P&L"]}
                />
                <Line
                  type="monotone"
                  dataKey="pnl"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div
              className="h-[200px] flex items-center justify-center rounded-xl text-sm"
              style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border)" }}
            >
              No closed trades yet — equity curve will appear here
            </div>
          )}
        </div>

        {/* Live prices */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Live Prices
            </span>
            <span className="w-1.5 h-1.5 rounded-full live-dot" style={{ background: "var(--green)" }} />
          </div>
          <div className="space-y-3">
            {PAIRS.map((pair) => (
              <div key={pair} className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  {pair}
                </span>
                <span className="text-sm font-mono font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                  {prices[pair]?.toFixed(5)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-[10px] text-center" style={{ color: "var(--text-muted)" }}>
              Simulated · Connect TradingView for live data
            </p>
          </div>
        </div>
      </div>

      {/* Open trades */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Open Positions
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>
            {openTrades.length} active
          </span>
        </div>
        {openTrades.length === 0 ? (
          <div
            className="py-10 text-center text-sm rounded-xl"
            style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border)" }}
          >
            No open positions · Waiting for TradingView signal
          </div>
        ) : (
          <div className="space-y-2">
            {openTrades.map((t) => (
              <TradeRow key={t.id} trade={t} currentPrice={prices[t.pair.replace(/\//g, "").slice(0, 6)] ?? t.entry_price} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div
      className="glass rounded-2xl p-4 transition-all hover:scale-[1.01]"
      style={{ cursor: "default" }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${accent}18`, color: accent }}
        >
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold tracking-tight" style={{ color: accent }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function TradeRow({ trade, currentPrice }: { trade: Trade; currentPrice: number }) {
  const isLong = trade.direction === "LONG";
  const diff = isLong ? currentPrice - trade.entry_price : trade.entry_price - currentPrice;
  const unrealisedPips = parseFloat((diff * 10000).toFixed(1));
  const positive = unrealisedPips >= 0;

  return (
    <div
      className="flex items-center justify-between px-4 py-3 rounded-xl text-sm"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-3">
        <span
          className="text-xs font-bold px-2 py-0.5 rounded"
          style={{
            background: isLong ? "rgba(0,255,136,0.15)" : "rgba(255,51,102,0.15)",
            color: isLong ? "var(--green)" : "var(--red)",
          }}
        >
          {isLong ? "LONG" : "SHORT"}
        </span>
        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
          {trade.pair}
        </span>
        <span style={{ color: "var(--text-muted)" }}>@ {trade.entry_price}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
          <Clock size={11} />
          {new Date(trade.open_time * 1000).toLocaleTimeString()}
        </div>
        <span
          className="text-sm font-bold"
          style={{ color: positive ? "var(--green)" : "var(--red)" }}
        >
          {positive ? "+" : ""}{unrealisedPips} pips
        </span>
      </div>
    </div>
  );
}
