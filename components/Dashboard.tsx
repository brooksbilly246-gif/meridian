"use client";
import { useEffect, useState, useRef } from "react";
import {
  TrendingUp,
  TrendingDown,
  Landmark,
  Activity,
  Target,
  Clock,
  Globe,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  Crosshair,
  Building2,
} from "lucide-react";
import { formatAED } from "@/lib/currency";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
  AreaChart,
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

type IbkrAccountRow = { value: string | null; currency: string | null };
type IbkrPosition = {
  symbol: string; pair: string | null; sec_type: string;
  position: number; avg_cost: number | null; currency: string | null; updated_at: number;
};
type IbkrData = {
  account: Record<string, IbkrAccountRow>;
  positions: IbkrPosition[];
};

const PAIRS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD"];

const mockPrices: Record<string, number> = {
  "EUR/USD": 1.0845,
  "GBP/USD": 1.2731,
  "USD/JPY": 157.42,
  "AUD/USD": 0.6523,
  "USD/CAD": 1.3611,
};

const SESSIONS = [
  { name: "Sydney", start: 22, end: 7, color: "var(--yellow)" },
  { name: "Tokyo", start: 0, end: 9, color: "var(--red)" },
  { name: "London", start: 8, end: 17, color: "var(--accent)" },
  { name: "New York", start: 13, end: 22, color: "#6366f1" },
];

function getActiveSessions(utcHour: number) {
  return SESSIONS.filter((s) => {
    if (s.start < s.end) return utcHour >= s.start && utcHour < s.end;
    return utcHour >= s.start || utcHour < s.end;
  });
}

function useTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [pnlHistory, setPnlHistory] = useState<PnlPoint[]>([]);
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [ibkr, setIbkr] = useState<IbkrData | null>(null);
  const [prices, setPrices] = useState(mockPrices);
  const [prevPrices, setPrevPrices] = useState(mockPrices);
  const now = useTime();

  async function fetchData() {
    const [s, t, ib] = await Promise.all([
      fetch("/api/stats").then((r) => r.json()),
      fetch("/api/trades?type=open").then((r) => r.json()),
      fetch("/api/ibkr").then((r) => r.json()).catch(() => null),
    ]);
    setStats(s.stats);
    setPnlHistory(s.pnlHistory);
    setOpenTrades(t);
    if (ib && !ib.error) setIbkr(ib);
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const tick = setInterval(() => {
      setPrices((prev) => {
        setPrevPrices(prev);
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
  const balance = parseFloat(stats?.balance ?? "10000");
  const winRate = parseFloat(stats?.winRate ?? "0");
  const activeSessions = getActiveSessions(now.getUTCHours());

  return (
    <div className="p-6 lg:p-8 space-y-5 fade-up">
      {/* Hero Balance */}
      <div className="hero-card relative overflow-hidden rounded-2xl p-6 lg:p-8">
        <div className="hero-glow" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span
                className="text-[10px] font-semibold tracking-[0.2em] uppercase"
                style={{ color: "var(--text-muted)" }}
              >
                Total Balance
              </span>
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-widest uppercase"
                style={{
                  color: "var(--accent)",
                  background: "var(--accent-dim)",
                  border: "1px solid var(--accent-border)",
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full live-dot"
                  style={{ background: "var(--accent)" }}
                />
                Paper
              </div>
            </div>
            <div
              className="text-[clamp(2rem,5vw,3.5rem)] font-bold tracking-tighter leading-none tabular-nums"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-data)" }}
            >
              {formatAED(balance)}
            </div>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-1.5">
                {pnlPositive ? (
                  <ArrowUpRight size={14} style={{ color: "var(--green)" }} />
                ) : (
                  <ArrowDownRight size={14} style={{ color: "var(--red)" }} />
                )}
                <span
                  className="text-sm font-semibold tabular-nums"
                  style={{
                    color: pnlPositive ? "var(--green)" : "var(--red)",
                    fontFamily: "var(--font-data)",
                  }}
                >
                  {formatAED(pnl, { sign: true })}
                </span>
              </div>
              <span
                className="text-xs tabular-nums"
                style={{ color: "var(--text-muted)", fontFamily: "var(--font-data)" }}
              >
                {stats?.totalPips ?? "0"} pips
              </span>
            </div>
          </div>

          {/* Clock + Sessions */}
          <div className="flex flex-col items-end gap-2">
            <div
              className="text-2xl font-bold tabular-nums tracking-tight"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-data)" }}
            >
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
            <div className="flex items-center gap-2">
              <Globe size={11} style={{ color: "var(--text-muted)" }} />
              {activeSessions.length > 0 ? (
                activeSessions.map((s) => (
                  <span
                    key={s.name}
                    className="text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full"
                    style={{
                      color: s.color,
                      background: `color-mix(in srgb, ${s.color} 10%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${s.color} 20%, transparent)`,
                    }}
                  >
                    {s.name}
                  </span>
                ))
              ) : (
                <span className="text-[9px] tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Markets closed
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Session timeline bar */}
        <div className="relative z-10 mt-6">
          <div className="session-timeline h-1 rounded-full overflow-hidden flex">
            {Array.from({ length: 24 }).map((_, h) => {
              const sessions = getActiveSessions(h);
              const color = sessions.length > 0 ? sessions[sessions.length - 1].color : "var(--border)";
              return (
                <div
                  key={h}
                  className="flex-1 transition-colors"
                  style={{
                    background: color,
                    opacity: h === now.getUTCHours() ? 1 : sessions.length > 0 ? 0.3 : 0.1,
                  }}
                />
              );
            })}
          </div>
          <div
            className="flex justify-between mt-1.5 text-[8px] tabular-nums"
            style={{ color: "var(--text-muted)", fontFamily: "var(--font-data)" }}
          >
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          label="Balance"
          value={formatAED(balance)}
          icon={<Landmark size={14} />}
          accent="var(--accent)"
          ring={balance > 0 ? Math.min((balance / 15000) * 100, 100) : 0}
        />
        <StatCard
          label="P&L"
          value={formatAED(pnl, { sign: true })}
          sub={`${stats?.totalPips ?? "0"} pips`}
          icon={pnlPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          accent={pnlPositive ? "var(--green)" : "var(--red)"}
          sparkData={pnlHistory.slice(-12).map((p) => p.pnl)}
        />
        <StatCard
          label="Win Rate"
          value={`${stats?.winRate ?? "0"}%`}
          sub={`${stats?.wins ?? 0}W  ${stats?.losses ?? 0}L`}
          icon={<Target size={14} />}
          accent="var(--yellow)"
          ring={winRate}
        />
        <StatCard
          label="Open"
          value={String(stats?.openTrades ?? 0)}
          sub={`${stats?.totalTrades ?? 0} closed`}
          icon={<Activity size={14} />}
          accent="var(--accent)"
        />
      </div>

      {/* IBKR Panel */}
      <IbkrPanel data={ibkr} />

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {/* Equity curve */}
        <div className="xl:col-span-2 card card-glow p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                Equity Curve
              </span>
              {pnlHistory.length > 0 && (
                <span
                  className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded"
                  style={{
                    color: pnlPositive ? "var(--green)" : "var(--red)",
                    background: pnlPositive ? "var(--green-dim)" : "var(--red-dim)",
                    fontFamily: "var(--font-data)",
                  }}
                >
                  {pnlPositive ? "+" : ""}{((pnl / balance) * 100).toFixed(2)}%
                </span>
              )}
            </div>
            <span
              className="text-[10px] font-medium"
              style={{ color: "var(--text-muted)", fontFamily: "var(--font-data)" }}
            >
              cumulative
            </span>
          </div>
          {pnlHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={pnlHistory}>
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="50%" stopColor="#10b981" stopOpacity={0.05} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#141414"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#4a4a4a", fontSize: 10, fontFamily: "var(--font-data)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#4a4a4a", fontSize: 10, fontFamily: "var(--font-data)" }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(10, 10, 10, 0.95)",
                    border: "1px solid rgba(16, 185, 129, 0.15)",
                    borderRadius: 10,
                    color: "#f0f0f0",
                    fontSize: 11,
                    fontFamily: "var(--font-data)",
                    backdropFilter: "blur(12px)",
                  }}
                  formatter={(v: unknown) => [formatAED(v as number), "P&L"]}
                />
                <Area
                  type="monotone"
                  dataKey="pnl"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#eqGrad)"
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: "#10b981",
                    stroke: "#050505",
                    strokeWidth: 2,
                    filter: "url(#glow)",
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="equity-empty h-[220px] flex flex-col items-center justify-center rounded-xl gap-2">
              <Crosshair size={20} style={{ color: "var(--accent)", opacity: 0.3 }} />
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Waiting for first closed trade
              </span>
              <span className="text-[10px]" style={{ color: "var(--border)" }}>
                Equity curve will appear here
              </span>
            </div>
          )}
        </div>

        {/* Live prices */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                Live Prices
              </span>
              <span
                className="w-1.5 h-1.5 rounded-full live-dot"
                style={{ background: "var(--accent)" }}
              />
            </div>
            <span
              className="text-[9px] tracking-wider uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              Simulated
            </span>
          </div>
          <div className="space-y-1">
            {PAIRS.map((pair) => {
              const current = prices[pair];
              const prev = prevPrices[pair];
              const direction = current > prev ? 1 : current < prev ? -1 : 0;
              return (
                <PriceRow
                  key={pair}
                  pair={pair}
                  price={current}
                  direction={direction}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Open trades */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              Open Positions
            </span>
            {openTrades.length > 0 && (
              <span
                className="text-[10px] font-bold tabular-nums w-5 h-5 flex items-center justify-center rounded-md"
                style={{
                  color: "var(--accent)",
                  background: "var(--accent-dim)",
                  fontFamily: "var(--font-data)",
                }}
              >
                {openTrades.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Shield size={11} style={{ color: "var(--text-muted)" }} />
            <span
              className="text-[9px] tracking-wider uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              SL/TP Protected
            </span>
          </div>
        </div>
        {openTrades.length === 0 ? (
          <div className="positions-empty py-12 flex flex-col items-center justify-center gap-2 rounded-xl">
            <div className="pulse-ring">
              <Activity size={16} style={{ color: "var(--accent)", opacity: 0.4 }} />
            </div>
            <span className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
              Scanning for London Breakout signal
            </span>
            <span className="text-[10px]" style={{ color: "var(--border)" }}>
              Positions will appear when a trade is triggered
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {openTrades.map((t) => (
              <TradeRow
                key={t.id}
                trade={t}
                currentPrice={
                  prices[t.pair] ?? t.entry_price
                }
              />
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
  sparkData,
  ring,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: string;
  sparkData?: number[];
  ring?: number;
}) {
  return (
    <div className="card stat-card relative overflow-hidden px-4 py-4" style={{ cursor: "default" }}>
      <div className="flex items-center justify-between mb-2.5">
        <span
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          {label}
        </span>
        {ring !== undefined ? (
          <MiniRing percent={ring} color={accent} icon={icon} />
        ) : (
          <div style={{ color: accent, opacity: 0.7 }}>{icon}</div>
        )}
      </div>
      <div
        className="text-[22px] font-bold tracking-tight tabular-nums"
        style={{ color: accent, fontFamily: "var(--font-data)" }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="text-[10px] mt-1 font-medium tabular-nums"
          style={{ color: "var(--text-muted)", fontFamily: "var(--font-data)" }}
        >
          {sub}
        </div>
      )}
      {sparkData && sparkData.length > 1 && (
        <MiniSpark data={sparkData} color={accent} />
      )}
    </div>
  );
}

function MiniRing({
  percent,
  color,
  icon,
}: {
  percent: number;
  color: string;
  icon: React.ReactNode;
}) {
  const r = 12;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;

  return (
    <div className="relative w-8 h-8 flex items-center justify-center">
      <svg width={32} height={32} className="absolute inset-0 -rotate-90">
        <circle
          cx={16}
          cy={16}
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth={2}
        />
        <circle
          cx={16}
          cy={16}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          opacity={0.8}
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      <div style={{ color, opacity: 0.7 }}>{icon}</div>
    </div>
  );
}

function MiniSpark({ data, color }: { data: number[]; color: string }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 24;
  const w = 60;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={w}
      height={h}
      className="absolute bottom-3 right-3 opacity-30"
      viewBox={`0 0 ${w} ${h}`}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PriceRow({
  pair,
  price,
  direction,
}: {
  pair: string;
  price: number;
  direction: number;
}) {
  const decimals = pair === "USD/JPY" ? 3 : 5;
  const priceStr = price.toFixed(decimals);
  const bigPart = priceStr.slice(0, -2);
  const pipPart = priceStr.slice(-2);

  return (
    <div
      className="flex items-center justify-between py-2 px-2.5 rounded-lg price-row transition-colors"
      style={{
        background:
          direction !== 0
            ? `color-mix(in srgb, ${direction > 0 ? "var(--green)" : "var(--red)"} 4%, transparent)`
            : "transparent",
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-1 h-4 rounded-full transition-colors"
          style={{
            background:
              direction > 0
                ? "var(--green)"
                : direction < 0
                ? "var(--red)"
                : "var(--border)",
            opacity: direction !== 0 ? 0.8 : 0.3,
          }}
        />
        <span
          className="text-[11px] font-semibold tracking-wide"
          style={{ color: "var(--text-secondary)" }}
        >
          {pair}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="text-[13px] font-medium tabular-nums"
          style={{
            color: "var(--text-muted)",
            fontFamily: "var(--font-data)",
          }}
        >
          {bigPart}
        </span>
        <span
          className="text-[15px] font-bold tabular-nums"
          style={{
            color:
              direction > 0
                ? "var(--green)"
                : direction < 0
                ? "var(--red)"
                : "var(--text-primary)",
            fontFamily: "var(--font-data)",
            transition: "color 300ms ease",
          }}
        >
          {pipPart}
        </span>
        {direction !== 0 && (
          <div
            className="price-tick"
            style={{
              color: direction > 0 ? "var(--green)" : "var(--red)",
            }}
          >
            {direction > 0 ? (
              <ArrowUpRight size={10} />
            ) : (
              <ArrowDownRight size={10} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function IbkrPanel({ data }: { data: IbkrData | null }) {
  const acc = data?.account ?? {};
  const positions = data?.positions ?? [];
  const hasData = Object.keys(acc).length > 0;

  const val = (key: string) => parseFloat(acc[key]?.value ?? "0");
  const netLiq    = val("NetLiquidation");
  const cash      = val("TotalCashValue");
  const buyPower  = val("BuyingPower");
  const unrealPnl = val("UnrealizedPnL");

  const lastUpdated = positions[0]?.updated_at ?? 0;
  const isStale = hasData && lastUpdated > 0 && (Date.now() / 1000 - lastUpdated) > 120;
  const statusColor = !hasData ? "var(--border)" : isStale ? "var(--yellow)" : "var(--green)";
  const statusLabel = !hasData ? "Not connected" : isStale ? "Stale" : "Live";

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Building2 size={14} style={{ color: "var(--text-muted)" }} />
          <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            IBKR Paper Account
          </span>
          <div
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-widest uppercase"
            style={{
              color: statusColor,
              background: `color-mix(in srgb, ${statusColor} 10%, transparent)`,
              border: `1px solid color-mix(in srgb, ${statusColor} 20%, transparent)`,
            }}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${hasData && !isStale ? "live-dot" : ""}`}
              style={{ background: statusColor }}
            />
            {statusLabel}
          </div>
        </div>
        <span className="text-[10px] tracking-wider uppercase" style={{ color: "var(--text-muted)" }}>
          Interactive Brokers
        </span>
      </div>

      {hasData ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <AcctMetric label="Net Liquidation" value={formatAED(netLiq)} />
            <AcctMetric label="Cash" value={formatAED(cash)} />
            <AcctMetric label="Buying Power" value={formatAED(buyPower)} />
            <AcctMetric
              label="Unrealized P&L"
              value={formatAED(unrealPnl, { sign: true })}
              positive={unrealPnl >= 0}
            />
          </div>

          {positions.length > 0 ? (
            <div className="space-y-2">
              <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
                Positions
              </span>
              {positions.map((pos) => (
                <IbkrPositionRow key={pos.symbol} pos={pos} />
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
              No open positions
            </div>
          )}
        </>
      ) : (
        <div className="py-8 flex flex-col items-center gap-2">
          <Activity size={16} style={{ color: "var(--text-muted)", opacity: 0.3 }} />
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Bridge not running
          </span>
          <span className="text-[10px]" style={{ color: "var(--border)" }}>
            Run{" "}
            <code
              className="px-1.5 py-0.5 rounded text-[10px]"
              style={{ background: "var(--bg-surface)", color: "var(--accent)" }}
            >
              npm run ibkr-bridge
            </code>{" "}
            in a second terminal
          </span>
        </div>
      )}
    </div>
  );
}

function AcctMetric({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  const color =
    positive === undefined
      ? "var(--text-primary)"
      : positive
      ? "var(--green)"
      : "var(--red)";

  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <div className="text-[9px] font-semibold tracking-widest uppercase mb-1" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="text-[13px] font-bold tabular-nums" style={{ color, fontFamily: "var(--font-data)" }}>
        {value}
      </div>
    </div>
  );
}

function IbkrPositionRow({ pos }: { pos: IbkrPosition }) {
  const isLong = pos.position > 0;
  const label  = pos.pair ?? pos.symbol;
  const qty    = Math.abs(pos.position).toLocaleString();
  const isJpy  = label.includes("JPY");
  const cost   = pos.avg_cost != null ? pos.avg_cost.toFixed(isJpy ? 3 : 5) : null;

  return (
    <div
      className="flex items-center justify-between py-2 px-3 rounded-lg"
      style={{
        background: "var(--bg-surface)",
        border: `1px solid ${isLong ? "rgba(16,185,129,0.08)" : "rgba(244,63,94,0.08)"}`,
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider"
          style={{
            background: isLong ? "var(--green-dim)" : "var(--red-dim)",
            color: isLong ? "var(--green)" : "var(--red)",
          }}
        >
          {isLong ? "Long" : "Short"}
        </span>
        <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {label}
        </span>
      </div>
      <div
        className="flex items-center gap-4 text-[11px] tabular-nums"
        style={{ fontFamily: "var(--font-data)", color: "var(--text-muted)" }}
      >
        <span>{qty}</span>
        {cost && <span style={{ color: "var(--text-secondary)" }}>@ {cost}</span>}
      </div>
    </div>
  );
}

function TradeRow({
  trade,
  currentPrice,
}: {
  trade: Trade;
  currentPrice: number;
}) {
  const isLong = trade.direction === "LONG";
  const diff = isLong
    ? currentPrice - trade.entry_price
    : trade.entry_price - currentPrice;
  const unrealisedPips = parseFloat((diff * 10000).toFixed(1));
  const positive = unrealisedPips >= 0;

  const slDistance = Math.abs(trade.entry_price - trade.stop_loss);
  const tpDistance = Math.abs(trade.take_profit - trade.entry_price);
  const currentDistance = Math.abs(currentPrice - trade.entry_price);
  const progressToTp = tpDistance > 0 ? Math.min((currentDistance / tpDistance) * 100, 100) : 0;
  const progressToSl = slDistance > 0 ? Math.min((currentDistance / slDistance) * 100, 100) : 0;
  const progressPercent = positive ? progressToTp : -progressToSl;

  return (
    <div
      className="trade-row rounded-xl p-3 transition-colors"
      style={{
        background: "var(--bg-surface)",
        border: `1px solid ${positive ? "rgba(16,185,129,0.08)" : "rgba(244,63,94,0.08)"}`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <span
            className="text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider"
            style={{
              background: isLong ? "var(--green-dim)" : "var(--red-dim)",
              color: isLong ? "var(--green)" : "var(--red)",
            }}
          >
            {isLong ? "Long" : "Short"}
          </span>
          <span
            className="text-[13px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {trade.pair}
          </span>
          <span
            className="text-[11px] tabular-nums"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-data)",
            }}
          >
            @ {trade.entry_price}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1 text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            <Clock size={10} />
            {new Date(trade.open_time * 1000).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <span
            className="text-sm font-bold tabular-nums"
            style={{
              color: positive ? "var(--green)" : "var(--red)",
              fontFamily: "var(--font-data)",
            }}
          >
            {positive ? "+" : ""}
            {unrealisedPips} <span className="text-[10px] font-normal">pips</span>
          </span>
        </div>
      </div>

      {/* SL/TP progress bar */}
      <div className="flex items-center gap-2">
        <span
          className="text-[8px] font-bold tracking-wider uppercase tabular-nums"
          style={{ color: "var(--red)", fontFamily: "var(--font-data)", opacity: 0.6 }}
        >
          SL
        </span>
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
          <div className="h-full rounded-full relative">
            {positive ? (
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progressPercent}%`,
                  background: "var(--green)",
                  opacity: 0.6,
                }}
              />
            ) : (
              <div
                className="h-full rounded-full transition-all duration-500 ml-auto"
                style={{
                  width: `${Math.abs(progressPercent)}%`,
                  background: "var(--red)",
                  opacity: 0.6,
                }}
              />
            )}
          </div>
        </div>
        <span
          className="text-[8px] font-bold tracking-wider uppercase tabular-nums"
          style={{ color: "var(--green)", fontFamily: "var(--font-data)", opacity: 0.6 }}
        >
          TP
        </span>
      </div>
    </div>
  );
}
