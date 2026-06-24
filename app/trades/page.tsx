"use client";
import { useEffect, useState, useCallback } from "react";
import { formatAED } from "@/lib/currency";
import { Clock, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

const PAIRS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD"];
const INITIAL_PRICES: Record<string, number> = {
  "EUR/USD": 1.0845,
  "GBP/USD": 1.2731,
  "USD/JPY": 157.42,
  "AUD/USD": 0.6523,
  "USD/CAD": 1.3611,
};

type Signal = {
  id: number;
  pair: string;
  direction: string;
  timeframe: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  trigger_at: number | null;
  created_at: number;
  executed: number;
};

type Trade = {
  id: number;
  pair: string;
  direction: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  pnl: number;
  pnl_pips: number;
  status: string;
  open_time: number;
  close_time: number;
  close_price: number;
};

export default function TradesPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [now, setNow] = useState(Date.now());
  const [prices, setPrices] = useState(INITIAL_PRICES);
  const [ibkrPrices, setIbkrPrices] = useState<Record<string, number>>({});
  const [ibkrUnrealizedPnl, setIbkrUnrealizedPnl] = useState<number | null>(null);
  const fetchData = useCallback(async () => {
    const [s, t, ib] = await Promise.all([
      fetch("/api/trades?type=signals").then((r) => r.json()),
      fetch("/api/trades?type=all").then((r) => r.json()),
      fetch("/api/ibkr").then((r) => r.json()).catch(() => null),
    ]);
    setSignals(s);
    setTrades(t);
    if (ib && !ib.error) {
      if (ib.prices && Object.keys(ib.prices).length > 0) {
        setIbkrPrices(ib.prices);
      }
      const unrealVal = parseFloat(ib.account?.UnrealizedPnL?.value ?? "");
      if (!isNaN(unrealVal)) setIbkrUnrealizedPnl(unrealVal);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const d = setInterval(fetchData, 8000);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(d); clearInterval(t); };
  }, [fetchData]);

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

  const pending = signals.filter((s) => !s.executed);
  const open = trades.filter((t) => t.status === "OPEN");
  const closed = trades.filter((t) => t.status === "CLOSED");
  const hasIbkr = Object.keys(ibkrPrices).length > 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Trades
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
          Upcoming setups, open positions & history
        </p>
      </div>

      {/* Upcoming signals */}
      <Section title="Upcoming Setups" badge={pending.length} badgeColor="var(--yellow)">
        {pending.length === 0 ? (
          <Empty label="No pending signals · Awaiting TradingView alerts" />
        ) : (
          <div className="space-y-3">
            {pending.map((sig) => (
              <SignalCard key={sig.id} signal={sig} now={now} />
            ))}
          </div>
        )}
      </Section>

      {/* Open trades */}
      <Section title="Open Positions" badge={open.length} badgeColor="var(--green)">
        {open.length === 0 ? (
          <Empty label="No open positions" />
        ) : (
          <TradeTable
            trades={open}
            prices={hasIbkr ? { ...prices, ...ibkrPrices } : prices}
            ibkrUnrealizedPnl={hasIbkr ? ibkrUnrealizedPnl : null}
          />
        )}
      </Section>

      {/* Trade history */}
      <Section title="Trade History" badge={closed.length} badgeColor="var(--accent)">
        {closed.length === 0 ? (
          <Empty label="No closed trades yet" />
        ) : (
          <TradeTable trades={closed} showClose />
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  badge,
  badgeColor,
  children,
}: {
  title: string;
  badge: number;
  badgeColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </span>
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ background: `${badgeColor}18`, color: badgeColor }}
        >
          {badge}
        </span>
      </div>
      {children}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div
      className="py-10 text-center text-sm rounded-xl"
      style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border)" }}
    >
      {label}
    </div>
  );
}

function SignalCard({ signal, now }: { signal: Signal; now: number }) {
  const isLong = signal.direction === "LONG";
  const triggerMs = signal.trigger_at ? signal.trigger_at * 1000 : null;
  const secondsLeft = triggerMs ? Math.max(0, Math.floor((triggerMs - now) / 1000)) : null;

  let alertWindow: string | null = null;
  if (secondsLeft !== null) {
    if (secondsLeft <= 60) alertWindow = "1m";
    else if (secondsLeft <= 300) alertWindow = "5m";
    else if (secondsLeft <= 900) alertWindow = "15m";
  }

  const alertColors: Record<string, string> = {
    "1m": "var(--red)",
    "5m": "var(--yellow)",
    "15m": "var(--accent)",
  };

  const formatCountdown = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className="rounded-xl p-4 transition-all"
      style={{
        background: alertWindow
          ? `rgba(${alertWindow === "1m" ? "255,51,102" : alertWindow === "5m" ? "255,215,0" : "0,212,255"},0.05)`
          : "rgba(255,255,255,0.03)",
        border: `1px solid ${alertWindow ? alertColors[alertWindow] + "40" : "var(--border)"}`,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isLong ? (
            <TrendingUp size={16} style={{ color: "var(--green)" }} />
          ) : (
            <TrendingDown size={16} style={{ color: "var(--red)" }} />
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
                {signal.pair}
              </span>
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  background: isLong ? "rgba(0,255,136,0.12)" : "rgba(255,51,102,0.12)",
                  color: isLong ? "var(--green)" : "var(--red)",
                }}
              >
                {signal.direction}
              </span>
              {signal.timeframe && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {signal.timeframe}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {signal.entry_price && <span>Entry: {signal.entry_price}</span>}
              {signal.stop_loss && <span>SL: {signal.stop_loss}</span>}
              {signal.take_profit && <span>TP: {signal.take_profit}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {alertWindow && (
            <div
              className="flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-full"
              style={{
                background: `${alertColors[alertWindow]}18`,
                color: alertColors[alertWindow],
              }}
            >
              <AlertTriangle size={11} />
              {alertWindow} ALERT
            </div>
          )}
          {secondsLeft !== null && (
            <div
              className="flex items-center gap-1.5 text-sm font-mono font-bold tabular-nums"
              style={{ color: alertWindow ? alertColors[alertWindow] : "var(--text-muted)" }}
            >
              <Clock size={13} />
              {formatCountdown(secondsLeft)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TradeTable({ trades, showClose, prices, ibkrUnrealizedPnl }: { trades: Trade[]; showClose?: boolean; prices?: Record<string, number>; ibkrUnrealizedPnl?: number | null }) {
  return (
    <div className="overflow-x-auto">
      {ibkrUnrealizedPnl != null && !showClose && (
        <div
          className="flex items-center justify-between mb-3 px-3 py-2 rounded-lg text-xs"
          style={{
            background: ibkrUnrealizedPnl >= 0 ? "rgba(0,255,136,0.06)" : "rgba(255,51,102,0.06)",
            border: `1px solid ${ibkrUnrealizedPnl >= 0 ? "rgba(0,255,136,0.15)" : "rgba(255,51,102,0.15)"}`,
          }}
        >
          <span style={{ color: "var(--text-muted)" }}>IBKR Unrealized P&L (incl. commissions)</span>
          <span
            className="font-bold font-mono tabular-nums"
            style={{ color: ibkrUnrealizedPnl >= 0 ? "var(--green)" : "var(--red)" }}
          >
            {formatAED(ibkrUnrealizedPnl, { sign: true })}
          </span>
        </div>
      )}
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
            <th className="pb-2 text-left font-medium">Pair</th>
            <th className="pb-2 text-left font-medium">Dir</th>
            <th className="pb-2 text-right font-medium">Entry</th>
            {showClose && <th className="pb-2 text-right font-medium">Close</th>}
            <th className="pb-2 text-right font-medium">SL</th>
            <th className="pb-2 text-right font-medium">TP</th>
            <th className="pb-2 text-right font-medium">P&L</th>
            <th className="pb-2 text-right font-medium">Pips</th>
            <th className="pb-2 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const isOpen = t.status === "OPEN" && prices;
            const pairKey = t.pair.length === 6 ? t.pair.slice(0, 3) + "/" + t.pair.slice(3) : t.pair;
            const currentPrice = isOpen ? (prices[pairKey] ?? t.entry_price) : null;
            const isLong = t.direction === "LONG";
            const diff = isOpen && currentPrice != null
              ? (isLong ? currentPrice - t.entry_price : t.entry_price - currentPrice)
              : 0;
            const livePnlPips = isOpen ? parseFloat((diff * 10000).toFixed(1)) : t.pnl_pips;
            const livePnl = isOpen ? diff : t.pnl;
            const pos = isOpen ? livePnlPips >= 0 : t.pnl >= 0;
            return (
              <tr
                key={t.id}
                style={{ borderBottom: "1px solid var(--border)" }}
                className="hover:bg-white/[0.02] transition-colors"
              >
                <td className="py-2.5 font-semibold" style={{ color: "var(--text-primary)" }}>{t.pair}</td>
                <td className="py-2.5">
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                    style={{
                      background: t.direction === "LONG" ? "rgba(0,255,136,0.15)" : "rgba(255,51,102,0.15)",
                      color: t.direction === "LONG" ? "var(--green)" : "var(--red)",
                    }}
                  >
                    {t.direction}
                  </span>
                </td>
                <td className="py-2.5 text-right font-mono" style={{ color: "var(--text-muted)" }}>{t.entry_price}</td>
                {showClose && (
                  <td className="py-2.5 text-right font-mono" style={{ color: "var(--text-muted)" }}>
                    {t.close_price ?? "—"}
                  </td>
                )}
                <td className="py-2.5 text-right font-mono" style={{ color: "var(--text-muted)" }}>{t.stop_loss ?? "—"}</td>
                <td className="py-2.5 text-right font-mono" style={{ color: "var(--text-muted)" }}>{t.take_profit ?? "—"}</td>
                <td className="py-2.5 text-right font-mono font-bold" style={{ color: pos ? "var(--green)" : "var(--red)" }}>
                  {formatAED(livePnl, { sign: true })}
                </td>
                <td className="py-2.5 text-right font-mono" style={{ color: pos ? "var(--green)" : "var(--red)" }}>
                  {pos ? "+" : ""}{livePnlPips?.toFixed(1)}
                </td>
                <td className="py-2.5 text-right" style={{ color: "var(--text-muted)" }}>
                  {new Date((t.open_time ?? t.close_time) * 1000).toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
