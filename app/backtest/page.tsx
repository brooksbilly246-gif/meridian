"use client";
import { useState } from "react";
import { formatAED, AED_RATE } from "@/lib/currency";
import { Play, Loader2, Zap, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { BacktestParams, BtTrade, PairResult, PortfolioSummary } from "@/app/api/backtest/route";

const ALL_PAIRS = ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCHF", "USDJPY", "USDCAD"];

const PAIR_COLORS: Record<string, string> = {
  EURUSD: "#00d4ff", GBPUSD: "#00ff88", AUDUSD: "#f59e0b",
  NZDUSD: "#a78bfa", USDCHF: "#fb923c", USDJPY: "#f472b6", USDCAD: "#34d399",
};

function defaultDates() {
  const to   = new Date();
  const from = new Date(Date.now() - 60 * 86400_000);
  const fmt  = (d: Date) => d.toISOString().split("T")[0];
  return { from: fmt(from), to: fmt(to) };
}

const dates = defaultDates();

const DEFAULTS: BacktestParams = {
  pairs:              ["EURUSD", "GBPUSD"],
  dateFrom:           dates.from,
  dateTo:             dates.to,
  startingBalanceAED: 10000,
  asianStart: 2, asianEnd: 7, breakoutStart: 8, breakoutEnd: 10, cutoffHour: 12,
  bufferPips: 2, tpMultiplier: 1.5, minRangePips: 15, maxRangePips: 50,
  riskPct: 2, breakevenR: 1,
};

const ENGINE_KEYS: Record<string, string> = {
  bufferPips:    "strategy_entry_buffer_pips",
  tpMultiplier:  "strategy_tp_multiplier",
  minRangePips:  "strategy_min_range_pips",
  maxRangePips:  "strategy_max_range_pips",
  riskPct:       "risk_per_trade",
  breakevenR:    "strategy_breakeven_r",
  asianStart:    "strategy_asian_start",
  asianEnd:      "strategy_asian_end",
  breakoutStart: "strategy_breakout_start",
  breakoutEnd:   "strategy_breakout_end",
  cutoffHour:    "strategy_close_cutoff",
};

type ResultData = {
  byPair:             PairResult[];
  portfolio:          { summary: PortfolioSummary; equityCurve: { date: string; balance: number }[]; allTrades: BtTrade[] };
  intervalUsed:       string;
  startingBalanceUsd: number;
};

export default function BacktestPage() {
  const [params, setParams]         = useState<BacktestParams>(DEFAULTS);
  const [running, setRunning]       = useState(false);
  const [result, setResult]         = useState<ResultData | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [applying, setApplying]     = useState(false);
  const [applied, setApplied]       = useState(false);
  const [logOpen, setLogOpen]       = useState(false);
  const [activePair, setActivePair] = useState<string | null>(null);

  function setNum(key: keyof BacktestParams) {
    return (v: string) => {
      const n = parseFloat(v);
      if (!isNaN(n)) setParams((p) => ({ ...p, [key]: n }));
    };
  }

  function togglePair(pair: string) {
    setParams((p) => ({
      ...p,
      pairs: p.pairs.includes(pair) ? p.pairs.filter((x) => x !== pair) : [...p.pairs, pair],
    }));
  }

  async function run() {
    if (!params.pairs.length) { setError("Select at least one pair"); return; }
    setRunning(true); setError(null); setResult(null); setApplied(false); setActivePair(null);
    try {
      const res  = await fetch("/api/backtest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Backtest failed");
      setResult(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  async function applyToEngine() {
    setApplying(true);
    try {
      const body: Record<string, string> = {};
      for (const [pk, sk] of Object.entries(ENGINE_KEYS)) {
        const v = params[pk as keyof BacktestParams];
        if (v !== undefined) body[sk] = String(v);
      }
      await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setApplied(true);
    } finally {
      setApplying(false);
    }
  }

  const s         = result?.portfolio.summary;
  const pf        = s?.profitFactor ?? 0;
  const showChart = activePair
    ? result?.byPair.find((r) => r.pair === activePair)?.equityCurve
    : result?.portfolio.equityCurve;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>Backtest</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
          London Session Breakout — Asian range build, breakout detection, SL/TP/breakeven management
        </p>
      </div>

      <div className="glass rounded-2xl p-5 space-y-5">
        {/* Pairs */}
        <section>
          <SectionLabel>Pairs</SectionLabel>
          <div className="flex flex-wrap gap-2 mt-2">
            {ALL_PAIRS.map((p) => {
              const on = params.pairs.includes(p);
              return (
                <button key={p} onClick={() => togglePair(p)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={{
                    background: on ? `${PAIR_COLORS[p]}18` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${on ? PAIR_COLORS[p] + "55" : "var(--border)"}`,
                    color: on ? PAIR_COLORS[p] : "var(--text-muted)",
                  }}
                >{p.slice(0, 3)}/{p.slice(3)}</button>
              );
            })}
            <button onClick={() => setParams((p) => ({ ...p, pairs: ALL_PAIRS }))}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >All</button>
          </div>
        </section>

        {/* Date range + Account */}
        <section>
          <SectionLabel>Date Range</SectionLabel>
          <div className="flex gap-3 mt-2 flex-wrap">
            <DateField label="From" value={params.dateFrom} onChange={(v) => setParams((p) => ({ ...p, dateFrom: v }))} />
            <DateField label="To"   value={params.dateTo}   onChange={(v) => setParams((p) => ({ ...p, dateTo: v }))} />
          </div>
        </section>

        <section>
          <SectionLabel>Account</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-2">
            <NumField label="Starting Balance (AED)" value={params.startingBalanceAED} onChange={setNum("startingBalanceAED")} step="100" />
          </div>
        </section>

        {/* LSB Parameters */}
        <section>
          <SectionLabel>Session Windows (GMT)</SectionLabel>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-4 mt-2">
            <NumField label="Asian Start"    value={params.asianStart}    onChange={setNum("asianStart")} />
            <NumField label="Asian End"      value={params.asianEnd}      onChange={setNum("asianEnd")} />
            <NumField label="Breakout Start" value={params.breakoutStart} onChange={setNum("breakoutStart")} />
            <NumField label="Breakout End"   value={params.breakoutEnd}   onChange={setNum("breakoutEnd")} />
            <NumField label="Force Close"    value={params.cutoffHour}    onChange={setNum("cutoffHour")} />
          </div>
        </section>

        <section>
          <SectionLabel>Trade Parameters</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-2">
            <NumField label="Buffer (pips)"    value={params.bufferPips}   onChange={setNum("bufferPips")}   step="0.5" />
            <NumField label="TP (x range)"     value={params.tpMultiplier} onChange={setNum("tpMultiplier")} step="0.25" />
            <NumField label="Min Range (pips)" value={params.minRangePips} onChange={setNum("minRangePips")} />
            <NumField label="Max Range (pips)" value={params.maxRangePips} onChange={setNum("maxRangePips")} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-3">
            <NumField label="Risk per Trade (%)" value={params.riskPct}    onChange={setNum("riskPct")}    step="0.1" />
            <NumField label="Breakeven (x R)"    value={params.breakevenR} onChange={setNum("breakevenR")} step="0.25" />
          </div>
        </section>

        <button onClick={run} disabled={running || !params.pairs.length}
          className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
          style={{ background: "var(--accent)", color: "#000" }}
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {running ? `Running ${params.pairs.length} pair${params.pairs.length > 1 ? "s" : ""}...` : "Run Backtest"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(255,51,102,0.1)", border: "1px solid rgba(255,51,102,0.3)", color: "var(--red)" }}>
          {error}
        </div>
      )}

      {result && s && (
        <>
          {result.intervalUsed === "1h" && (
            <div className="rounded-xl px-4 py-2.5 text-xs" style={{ background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.2)", color: "var(--yellow)" }}>
              Using 1-hour candles (date range &gt; 58 days). Detection precision is slightly lower than live 15m engine.
            </div>
          )}

          {/* Portfolio summary */}
          <div>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Portfolio</h2>
              <button onClick={applyToEngine} disabled={applying || applied}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: applied ? "rgba(0,255,136,0.12)" : "rgba(0,212,255,0.1)",
                  border: `1px solid ${applied ? "rgba(0,255,136,0.4)" : "rgba(0,212,255,0.3)"}`,
                  color: applied ? "var(--green)" : "var(--accent)", opacity: applying ? 0.6 : 1,
                }}
              >
                {applying ? <Loader2 size={12} className="animate-spin" /> : applied ? <CheckCircle2 size={12} /> : <Zap size={12} />}
                {applied ? "Applied to Engine" : "Apply Params to Engine"}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Total Trades"  value={String(s.totalTrades)}                          color="var(--accent)" />
              <StatCard label="Win Rate"      value={`${s.winRate}%`}                                color={s.winRate >= 50 ? "var(--green)" : "var(--yellow)"} />
              <StatCard label="Wins / Losses" value={`${s.wins} / ${s.losses}`}                      color="var(--text-primary)" />
              <StatCard label="Total Pips"    value={`${s.totalPips >= 0 ? "+" : ""}${s.totalPips}`} color={s.totalPips >= 0 ? "var(--green)" : "var(--red)"} />
              <StatCard label="Net P&L"       value={formatAED(s.netPnl, { sign: true })}           color={s.netPnl >= 0 ? "var(--green)" : "var(--red)"} />
              <StatCard label="Final Balance" value={formatAED(s.finalBalance)}                      color="var(--accent)" />
              <StatCard label="Profit Factor" value={pf >= 999 ? "∞" : pf.toFixed(2)}               color={pf >= 1.5 ? "var(--green)" : pf >= 1 ? "var(--yellow)" : "var(--red)"} />
              <StatCard label="Max Drawdown"  value={`-${s.maxDrawdown.toFixed(1)}%`}               color={s.maxDrawdown > 15 ? "var(--red)" : s.maxDrawdown > 8 ? "var(--yellow)" : "var(--green)"} />
            </div>
          </div>

          {/* Advanced Analytics */}
          {s.advanced && (
            <div className="glass rounded-2xl p-5 space-y-4">
              <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Advanced Analytics</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <MiniStat label="Return" value={`${s.advanced.returnPct >= 0 ? "+" : ""}${s.advanced.returnPct}%`}
                  color={s.advanced.returnPct >= 0 ? "var(--green)" : "var(--red)"} />
                <MiniStat label="Sharpe" value={s.advanced.sharpeRatio.toFixed(2)}
                  color={s.advanced.sharpeRatio >= 1.5 ? "var(--green)" : s.advanced.sharpeRatio >= 0.5 ? "var(--yellow)" : "var(--red)"} />
                <MiniStat label="Sortino" value={s.advanced.sortinoRatio.toFixed(2)}
                  color={s.advanced.sortinoRatio >= 2 ? "var(--green)" : s.advanced.sortinoRatio >= 1 ? "var(--yellow)" : "var(--red)"} />
                <MiniStat label="Expectancy" value={formatAED(s.advanced.expectancy, { sign: true })}
                  color={s.advanced.expectancy >= 0 ? "var(--green)" : "var(--red)"} />
                <MiniStat label="Recovery" value={s.advanced.recoveryFactor.toFixed(2)}
                  color={s.advanced.recoveryFactor >= 2 ? "var(--green)" : s.advanced.recoveryFactor >= 1 ? "var(--yellow)" : "var(--red)"} />
                <MiniStat label="Trades/Week" value={s.advanced.avgTradesPerWeek.toFixed(1)} color="var(--accent)" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <MiniStat label="Avg Win" value={formatAED(s.advanced.avgWin)} color="var(--green)" />
                <MiniStat label="Avg Loss" value={formatAED(s.advanced.avgLoss)} color="var(--red)" />
                <MiniStat label="Avg Win (pips)" value={`+${s.advanced.avgWinPips}`} color="var(--green)" />
                <MiniStat label="Avg Loss (pips)" value={`${s.advanced.avgLossPips.toFixed(1)}`} color="var(--red)" />
                <MiniStat label="Best Trade" value={formatAED(s.advanced.largestWin)} color="var(--green)" />
                <MiniStat label="Worst Trade" value={formatAED(s.advanced.largestLoss)} color="var(--red)" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MiniStat label="Max Win Streak" value={String(s.advanced.maxConsecWins)} color="var(--green)" />
                <MiniStat label="Max Loss Streak" value={String(s.advanced.maxConsecLosses)}
                  color={s.advanced.maxConsecLosses >= 5 ? "var(--red)" : s.advanced.maxConsecLosses >= 3 ? "var(--yellow)" : "var(--green)"} />
              </div>

              {/* Outcome breakdown */}
              {Object.keys(s.advanced.outcomeBreakdown).length > 0 && (
                <div>
                  <div className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>Exit Type Distribution</div>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(s.advanced.outcomeBreakdown).map(([outcome, count]) => (
                      <div key={outcome} className="px-3 py-1.5 rounded-lg text-xs" style={{
                        background: outcome === "TP" ? "rgba(0,255,136,0.08)" : outcome === "SL" ? "rgba(255,51,102,0.08)" : "rgba(255,215,0,0.08)",
                        border: `1px solid ${outcome === "TP" ? "rgba(0,255,136,0.2)" : outcome === "SL" ? "rgba(255,51,102,0.2)" : "rgba(255,215,0,0.2)"}`,
                        color: outcome === "TP" ? "var(--green)" : outcome === "SL" ? "var(--red)" : "var(--yellow)",
                      }}>
                        <span className="font-bold">{outcome}</span>
                        <span className="ml-1.5 opacity-70">{count} ({s.totalTrades > 0 ? Math.round((count / s.totalTrades) * 100) : 0}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Monthly P&L */}
              {s.advanced.monthlyPnl.length > 0 && (
                <div>
                  <div className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>Monthly P&L</div>
                  <div className="overflow-x-auto">
                    <div className="flex gap-2">
                      {s.advanced.monthlyPnl.map((m) => (
                        <div key={m.month} className="flex-shrink-0 rounded-xl p-3 min-w-[110px]" style={{
                          background: m.pnl >= 0 ? "rgba(0,255,136,0.06)" : "rgba(255,51,102,0.06)",
                          border: `1px solid ${m.pnl >= 0 ? "rgba(0,255,136,0.15)" : "rgba(255,51,102,0.15)"}`,
                        }}>
                          <div className="text-[10px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>{m.month}</div>
                          <div className="text-sm font-bold" style={{ color: m.pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                            {formatAED(m.pnl, { sign: true })}
                          </div>
                          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{m.trades} trades</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Equity curve */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {activePair ? `${activePair.slice(0, 3)}/${activePair.slice(3)} Equity Curve` : "Portfolio Equity Curve"}
              </div>
              <div className="flex gap-1 flex-wrap">
                <PillBtn active={!activePair} onClick={() => setActivePair(null)}>All Pairs</PillBtn>
                {result.byPair.filter((r) => r.totalTrades > 0).map((r) => (
                  <PillBtn key={r.pair} active={activePair === r.pair}
                    onClick={() => setActivePair(activePair === r.pair ? null : r.pair)}
                    color={PAIR_COLORS[r.pair]}
                  >{r.pair.slice(0, 3)}/{r.pair.slice(3)}</PillBtn>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={showChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fill: "var(--text-muted)", fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} width={100}
                  tickFormatter={(v) => `AED ${Math.round(v * AED_RATE).toLocaleString("en-AE")}`} />
                <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", fontSize: 12 }}
                  formatter={(v: unknown) => [formatAED(v as number), "Balance"]} />
                <ReferenceLine y={result.startingBalanceUsd} stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4"
                  label={{ value: "Start", fill: "var(--text-muted)", fontSize: 10, position: "insideTopLeft" }} />
                <Line type="monotone" dataKey="balance" dot={false} strokeWidth={2}
                  stroke={activePair ? PAIR_COLORS[activePair] : "var(--accent)"} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Per-pair breakdown */}
          <div>
            <div className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>By Pair</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {result.byPair.map((r) => (
                <PairCard key={r.pair} result={r} />
              ))}
            </div>
          </div>

          {/* Trade log */}
          <div className="glass rounded-2xl overflow-hidden">
            <button onClick={() => setLogOpen((o) => !o)}
              className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold"
              style={{ color: "var(--text-primary)", borderBottom: logOpen ? "1px solid var(--border)" : "none" }}
            >
              <span>
                Trade Log
                <span className="ml-2 font-normal text-xs" style={{ color: "var(--text-muted)" }}>
                  {result.portfolio.allTrades.length} trades · {s.skippedDays} days skipped
                </span>
              </span>
              {logOpen ? <ChevronUp size={16} style={{ color: "var(--text-muted)" }} /> : <ChevronDown size={16} style={{ color: "var(--text-muted)" }} />}
            </button>
            {logOpen && (
              <div className="overflow-x-auto px-5 pb-4">
                <table className="w-full text-xs mt-3">
                  <thead>
                    <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                      {["Date", "Pair", "Dir", "Range", "Entry", "Close", "Outcome", "P&L", "Pips"].map((h) => (
                        <th key={h} className="text-left py-2 pr-4 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...(result.portfolio.allTrades)].reverse().map((t, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                        <td className="py-1.5 pr-4 font-mono" style={{ color: "var(--text-muted)" }}>{t.date}</td>
                        <td className="py-1.5 pr-4 font-bold text-[10px]" style={{ color: PAIR_COLORS[t.pair] }}>{t.pair.slice(0,3)}/{t.pair.slice(3)}</td>
                        <td className="py-1.5 pr-4 font-bold" style={{ color: t.direction === "LONG" ? "var(--green)" : "var(--red)" }}>{t.direction}</td>
                        <td className="py-1.5 pr-4" style={{ color: "var(--text-muted)" }}>{t.rangePips.toFixed(1)}p</td>
                        <td className="py-1.5 pr-4 font-mono" style={{ color: "var(--text-primary)" }}>{t.entry.toFixed(t.pair.includes("JPY") ? 3 : 5)}</td>
                        <td className="py-1.5 pr-4 font-mono" style={{ color: "var(--text-primary)" }}>{t.closePrice.toFixed(t.pair.includes("JPY") ? 3 : 5)}</td>
                        <td className="py-1.5 pr-4">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{
                            background: t.outcome === "TP" ? "rgba(0,255,136,0.15)" : t.outcome === "SL" ? "rgba(255,51,102,0.15)" : "rgba(255,215,0,0.15)",
                            color: t.outcome === "TP" ? "var(--green)" : t.outcome === "SL" ? "var(--red)" : "var(--yellow)",
                          }}>{t.outcome}</span>
                        </td>
                        <td className="py-1.5 pr-4 font-semibold" style={{ color: t.pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                          {formatAED(t.pnl, { sign: true })}
                        </td>
                        <td className="py-1.5" style={{ color: t.pips >= 0 ? "var(--green)" : "var(--red)" }}>
                          {t.pips >= 0 ? "+" : ""}{t.pips.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{children}</div>;
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-lg font-bold leading-tight" style={{ color }}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
      <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-sm font-bold font-mono" style={{ color }}>{value}</div>
    </div>
  );
}

function PairCard({ result: r }: { result: PairResult }) {
  const color  = PAIR_COLORS[r.pair];
  const gained = r.netPnl >= 0;
  const pf     = r.profitFactor;

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${color}22`, background: `${color}08` }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${color}18` }}>
        <span className="text-xs font-bold" style={{ color }}>{r.pair.slice(0,3)}/{r.pair.slice(3)}</span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{r.totalTrades} trades</span>
      </div>
      <div className="px-3 py-2.5 space-y-1.5">
        <MiniRow label="Net P&L" value={r.totalTrades > 0 ? formatAED(r.netPnl, { sign: true }) : "—"} color={gained ? "var(--green)" : "var(--red)"} />
        <MiniRow label="Win Rate" value={r.totalTrades > 0 ? `${r.winRate}%` : "—"} color={r.winRate >= 50 ? "var(--green)" : r.winRate > 0 ? "var(--yellow)" : "var(--text-muted)"} />
        <MiniRow label="P.Factor" value={r.totalTrades > 0 ? (pf >= 999 ? "∞" : pf.toFixed(2)) : "—"} color={pf >= 1.5 ? "var(--green)" : pf >= 1 ? "var(--yellow)" : pf > 0 ? "var(--red)" : "var(--text-muted)"} />
        <MiniRow label="Max DD"   value={r.totalTrades > 0 ? `-${r.maxDrawdown.toFixed(1)}%` : "—"} color={r.maxDrawdown > 15 ? "var(--red)" : r.maxDrawdown > 8 ? "var(--yellow)" : "var(--green)"} />
      </div>
    </div>
  );
}

function MiniRow({ label, value, color = "var(--text-primary)" }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="font-semibold font-mono" style={{ color }}>{value}</span>
    </div>
  );
}

function PillBtn({ children, active, onClick, color = "var(--accent)" }: { children: React.ReactNode; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button onClick={onClick}
      className="px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all"
      style={{
        background: active ? `${color}18` : "transparent",
        border: `1px solid ${active ? color + "44" : "var(--border)"}`,
        color: active ? color : "var(--text-muted)",
      }}
    >{children}</button>
  );
}

function NumField({ label, value, onChange, step = "1" }: { label: string; value: number; onChange: (v: string) => void; step?: string }) {
  return (
    <div>
      <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>{label}</label>
      <input type="number" value={value} step={step}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl px-3 py-2 text-sm outline-none"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
        onBlur={(e)  => (e.target.style.borderColor = "var(--border)")}
      />
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>{label}</label>
      <input type="date" value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl px-3 py-2 text-sm outline-none"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-primary)", colorScheme: "dark" }}
        onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
        onBlur={(e)  => (e.target.style.borderColor = "var(--border)")}
      />
    </div>
  );
}
