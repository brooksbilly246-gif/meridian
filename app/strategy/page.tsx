"use client";
import { useEffect, useState, useCallback } from "react";
import { formatAED } from "@/lib/currency";
import { Activity, Shield, AlertTriangle, CheckCircle, Clock, TrendingUp, TrendingDown, Zap, History, Undo2, Loader2 } from "lucide-react";

type Session = {
  pair: string; session_date: string;
  asian_high: number | null; asian_low: number | null; range_pips: number | null;
  breakout_direction: string | null; signal_fired: number; skipped_reason: string | null;
};
type RiskState = {
  daily_pnl: number; daily_trades: number;
  consecutive_losses: number; circuit_broken: number;
};
type LogEntry = { id: number; level: string; message: string; pair: string | null; created_at: number };
type SettingChange = {
  id: number; insight_category: string; insight_label: string;
  setting_key: string; old_value: string; new_value: string;
  reason: string | null; reverted: number; created_at: number;
};
type State = {
  today: string; enabled: boolean; pairs: string[];
  sessions: Session[]; riskState: RiskState; log: LogEntry[];
};

const LEVEL_COLORS: Record<string, string> = {
  INFO:   "var(--text-muted)",
  WARN:   "var(--yellow)",
  SIGNAL: "var(--accent)",
  TRADE:  "var(--green)",
  RISK:   "var(--red)",
};

export default function StrategyPage() {
  const [state, setState] = useState<State | null>(null);
  const [ticking, setTicking] = useState(false);
  const [lastTick, setLastTick] = useState<string | null>(null);
  const [nextTick, setNextTick] = useState(60);
  const [phase, setPhase] = useState<string>("—");
  const [changes, setChanges] = useState<SettingChange[]>([]);
  const [reverting, setReverting] = useState<number | null>(null);

  const fetchChanges = useCallback(async () => {
    const d = await fetch("/api/insights/history").then((r) => r.json());
    setChanges(d.changes ?? []);
  }, []);

  const fetchState = useCallback(async () => {
    const d = await fetch("/api/strategy/state").then((r) => r.json());
    setState(d);
  }, []);

  const tick = useCallback(async () => {
    setTicking(true);
    try {
      const r = await fetch("/api/strategy/tick", { method: "POST" }).then((r) => r.json());
      setPhase(r.phase);
      setLastTick(new Date().toLocaleTimeString());
      setNextTick(60);
      await fetchState();
    } finally {
      setTicking(false);
    }
  }, [fetchState]);

  // Auto-tick every 60s when strategy enabled
  useEffect(() => {
    fetchState();
    fetchChanges();
    const stateInterval = setInterval(fetchState, 10000);
    return () => clearInterval(stateInterval);
  }, [fetchState, fetchChanges]);

  useEffect(() => {
    if (!state?.enabled) return;
    tick(); // immediate first tick
    const tickInterval = setInterval(tick, 60000);
    const countdown    = setInterval(() => setNextTick((n) => Math.max(0, n - 1)), 1000);
    return () => { clearInterval(tickInterval); clearInterval(countdown); };
  }, [state?.enabled, tick]);

  async function toggleStrategy() {
    const newVal = !state?.enabled;
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy_enabled: newVal ? "true" : "false" }),
    });
    fetchState();
  }

  const rs = state?.riskState;
  const maxDailyLoss = 3; // shown from settings default

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Strategy Engine
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            London Session Breakout · Asian range build · Breakout detection · Paper trading
          </p>
        </div>

        {/* Master on/off */}
        <button
          onClick={toggleStrategy}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 active:scale-95"
          style={{
            background: state?.enabled ? "rgba(0,255,136,0.12)" : "rgba(255,255,255,0.06)",
            border: state?.enabled ? "1px solid rgba(0,255,136,0.4)" : "1px solid var(--border)",
            color: state?.enabled ? "var(--green)" : "var(--text-muted)",
          }}
        >
          <Zap size={15} />
          {state?.enabled ? "ENGINE ON" : "ENGINE OFF"}
        </button>
      </div>

      {/* Status row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatusCard
          label="Phase"
          value={ticking ? "TICKING…" : phase}
          color={phaseColor(phase)}
          icon={<Activity size={15} />}
          sub={state?.enabled ? `Next tick: ${nextTick}s` : "Engine off"}
        />
        <StatusCard
          label="Daily P&L"
          value={formatAED(rs?.daily_pnl ?? 0, { sign: true })}
          color={(rs?.daily_pnl ?? 0) >= 0 ? "var(--green)" : "var(--red)"}
          icon={<TrendingUp size={15} />}
          sub={`${rs?.daily_trades ?? 0} trades today`}
        />
        <StatusCard
          label="Loss Streak"
          value={`${rs?.consecutive_losses ?? 0} / 3`}
          color={(rs?.consecutive_losses ?? 0) >= 2 ? "var(--red)" : (rs?.consecutive_losses ?? 0) === 1 ? "var(--yellow)" : "var(--green)"}
          icon={<Shield size={15} />}
          sub="Circuit breaks at 3"
        />
        <StatusCard
          label="Last Tick"
          value={lastTick ?? "—"}
          color="var(--accent)"
          icon={<Clock size={15} />}
          sub={state?.today ?? ""}
        />
      </div>

      {/* Session cards */}
      <div className="glass rounded-2xl p-5">
        <div className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          Today&apos;s Sessions
        </div>
        {!state?.sessions.length ? (
          <Empty label="No session data yet — engine must run during Asian hours (02:00–07:00 GMT)" />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {state.sessions.map((s) => <SessionCard key={s.pair} session={s} />)}
          </div>
        )}
      </div>

      {/* Risk guards */}
      <div className="glass rounded-2xl p-5">
        <div className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          Loss-Minimisation Guards
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          {[
            { label: "Fixed fractional sizing",    desc: `Risk ${getSetting_client("risk_per_trade", "1")}% per trade — position size auto-calculated from balance and SL distance`, ok: true },
            { label: "Daily loss circuit breaker", desc: `Trading halts if daily loss exceeds ${maxDailyLoss}% — prevents revenge spirals`, ok: (rs?.daily_pnl ?? 0) > -(maxDailyLoss / 100) },
            { label: "Consecutive loss breaker",   desc: `Pauses after 3 losses in a row — forces review before re-engaging`, ok: (rs?.consecutive_losses ?? 0) < 3 },
            { label: "Breakeven rule",             desc: `SL moves to entry when trade moves 1R in profit — converts potential losers to free trades`, ok: true },
            { label: "Time cutoff 12:00 GMT",      desc: `All positions force-closed at 12:00 GMT — London edge is gone after this`, ok: true },
            { label: "Range size filter",          desc: `Skips if Asian range < 15 pips (whipsaw) or > 50 pips (SL too large)`, ok: true },
            { label: "Day filter Mon–Thu",         desc: `Friday excluded — thin liquidity, weekend positioning, higher reversals`, ok: true },
            { label: "False breakout filter",      desc: `Skips if both range levels broken same session — indicates choppy conditions`, ok: true },
            { label: "Portfolio heat cap",         desc: `Total open risk capped at 5% — protects against concentrated directional loss`, ok: true },
            { label: "Correlation filter",         desc: `Blocks same-direction trades on correlated pairs (e.g., EUR/USD + GBP/USD LONG)`, ok: true },
            { label: "Drawdown scaling",           desc: `Position sizes reduce 20–60% as account draws down — preserves capital in losing streaks`, ok: true },
            { label: "Hard drawdown stop at 20%",  desc: `No new trades if account is down 20%+ from starting balance`, ok: true },
          ].map(({ label, desc, ok }) => (
            <div
              key={label}
              className="flex gap-3 items-start p-3 rounded-xl"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}
            >
              {ok
                ? <CheckCircle size={14} className="shrink-0 mt-0.5" style={{ color: "var(--green)" }} />
                : <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: "var(--red)" }} />
              }
              <div>
                <div className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{label}</div>
                <div className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--text-muted)" }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Applied Modifications */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <History size={15} style={{ color: "var(--accent)" }} />
          <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Applied Modifications</div>
          {changes.filter((c) => !c.reverted).length > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(0,212,255,0.1)", color: "var(--accent)" }}>
              {changes.filter((c) => !c.reverted).length} active
            </span>
          )}
        </div>
        {!changes.length ? (
          <Empty label="No suggestions have been applied yet — run a backtest to see suggestions" />
        ) : (
          <div className="space-y-2">
            {changes.map((c) => (
              <div key={c.id} className="flex items-start gap-3 p-3 rounded-xl" style={{
                background: c.reverted ? "rgba(255,255,255,0.02)" : "rgba(0,212,255,0.04)",
                border: `1px solid ${c.reverted ? "var(--border)" : "rgba(0,212,255,0.15)"}`,
                opacity: c.reverted ? 0.5 : 1,
              }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{
                  background: c.reverted ? "rgba(255,255,255,0.04)" : "rgba(0,212,255,0.1)",
                  color: c.reverted ? "var(--text-muted)" : "var(--accent)",
                }}>
                  {c.reverted ? <Undo2 size={13} /> : <CheckCircle size={13} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold" style={{ color: c.reverted ? "var(--text-muted)" : "var(--text-primary)" }}>
                      {c.insight_label}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{
                      background: "rgba(255,255,255,0.06)", color: "var(--text-muted)",
                    }}>
                      {c.insight_category.replace(/_/g, " ")}
                    </span>
                    {c.reverted ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(255,215,0,0.1)", color: "var(--yellow)" }}>
                        REVERTED
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    <span className="font-mono">{c.setting_key}</span>: <span style={{ color: "var(--red)" }}>{c.old_value}</span> → <span style={{ color: "var(--green)" }}>{c.new_value}</span>
                  </div>
                  {c.reason && (
                    <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>{c.reason}</div>
                  )}
                  <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                    {new Date(c.created_at * 1000).toLocaleDateString()} {new Date(c.created_at * 1000).toLocaleTimeString()}
                  </div>
                </div>
                {!c.reverted && (
                  <button
                    disabled={reverting === c.id}
                    onClick={async () => {
                      setReverting(c.id);
                      await fetch("/api/insights/revert", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: c.id }),
                      });
                      await fetchChanges();
                      await fetchState();
                      setReverting(null);
                    }}
                    className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-90 active:scale-95"
                    style={{
                      background: "rgba(255,215,0,0.08)",
                      border: "1px solid rgba(255,215,0,0.25)",
                      color: "var(--yellow)",
                    }}
                  >
                    {reverting === c.id ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
                    Undo
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Strategy log */}
      <div className="glass rounded-2xl p-5">
        <div className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          Strategy Log
        </div>
        {!state?.log.length ? (
          <Empty label="No log entries yet" />
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {state.log.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 text-xs py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="shrink-0 font-bold w-14" style={{ color: LEVEL_COLORS[entry.level] ?? "var(--text-muted)" }}>
                  {entry.level}
                </span>
                {entry.pair && (
                  <span className="shrink-0 font-mono" style={{ color: "var(--accent)", minWidth: 60 }}>{entry.pair}</span>
                )}
                <span className="flex-1" style={{ color: "var(--text-primary)" }}>{entry.message}</span>
                <span className="shrink-0" style={{ color: "var(--text-muted)" }}>
                  {new Date(entry.created_at * 1000).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper — read a setting from the page (use default since we can't call server fn client-side)
function getSetting_client(key: string, fallback: string) {
  return fallback; // placeholder — settings are visible in Settings page
}

function phaseColor(phase: string) {
  if (phase === "ASIAN_RANGE")    return "var(--accent)";
  if (phase === "BREAKOUT_WATCH") return "var(--yellow)";
  if (phase === "MANAGING")       return "var(--green)";
  if (phase === "MARKET_CLOSED")  return "var(--yellow)";
  if (phase === "CLOSED")         return "var(--text-muted)";
  if (phase === "DISABLED")       return "var(--text-muted)";
  return "var(--text-muted)";
}

function StatusCard({ label, value, color, icon, sub }: {
  label: string; value: string; color: string; icon: React.ReactNode; sub?: string;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wide font-medium" style={{ color: "var(--text-muted)" }}>{label}</span>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}18`, color }}>
          {icon}
        </div>
      </div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}

function SessionCard({ session: s }: { session: Session }) {
  const hasRange  = s.asian_high != null && s.asian_low != null;
  const fired     = s.signal_fired === 1;
  const skipped   = !!s.skipped_reason;
  const isLong    = s.breakout_direction === "LONG";

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: fired ? "rgba(0,255,136,0.05)" : skipped ? "rgba(255,51,102,0.05)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${fired ? "rgba(0,255,136,0.25)" : skipped ? "rgba(255,51,102,0.2)" : "var(--border)"}`,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
          {s.pair.slice(0,3)}/{s.pair.slice(3)}
        </span>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            background: fired ? "rgba(0,255,136,0.15)" : skipped ? "rgba(255,51,102,0.15)" : "rgba(0,212,255,0.1)",
            color: fired ? "var(--green)" : skipped ? "var(--red)" : "var(--accent)",
          }}
        >
          {fired ? (isLong ? "▲ LONG FIRED" : "▼ SHORT FIRED") : skipped ? "SKIPPED" : "WATCHING"}
        </span>
      </div>

      <div className="space-y-1.5 text-xs">
        {hasRange ? (
          <>
            <Row label="Asian High" value={s.asian_high!.toFixed(5)} color="var(--green)" />
            <Row label="Asian Low"  value={s.asian_low!.toFixed(5)}  color="var(--red)" />
            <Row label="Range"      value={`${s.range_pips?.toFixed(1)} pips`}
              color={
                (s.range_pips ?? 0) < 15 ? "var(--red)"
                : (s.range_pips ?? 0) > 50 ? "var(--yellow)"
                : "var(--green)"
              }
            />
          </>
        ) : (
          <div style={{ color: "var(--text-muted)" }}>Range building… (02:00–07:00 GMT)</div>
        )}
        {s.skipped_reason && (
          <div className="mt-2 p-2 rounded-lg text-[10px] leading-relaxed" style={{ background: "rgba(255,51,102,0.08)", color: "var(--red)" }}>
            {s.skipped_reason}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="font-mono" style={{ color: color ?? "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="py-8 text-center text-sm rounded-xl"
      style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border)" }}>
      {label}
    </div>
  );
}
