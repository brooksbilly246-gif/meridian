"use client";
import { useEffect, useState } from "react";
import { Save, Copy, CheckCircle, Info, Trash2 } from "lucide-react";

const ALL_PAIRS = ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCHF", "USDJPY", "USDCAD"];

const PAIR_COLORS: Record<string, string> = {
  EURUSD: "#00d4ff", GBPUSD: "#00ff88", AUDUSD: "#f59e0b",
  NZDUSD: "#a78bfa", USDCHF: "#fb923c", USDJPY: "#f472b6", USDCAD: "#34d399",
};

type Settings = {
  paper_balance: string; imessage_target: string; webhook_secret: string;
  risk_per_trade: string; default_lot_size: string;
  strategy_pairs: string; strategy_asian_start: string; strategy_asian_end: string;
  strategy_breakout_start: string; strategy_breakout_end: string; strategy_close_cutoff: string;
  strategy_min_range_pips: string; strategy_max_range_pips: string;
  strategy_entry_buffer_pips: string; strategy_tp_multiplier: string;
  strategy_breakeven_r: string; strategy_trend_filter: string;
  strategy_max_daily_loss_pct: string; strategy_max_consec_losses: string;
  strategy_max_portfolio_heat: string; strategy_correlation_filter: string;
  [key: string]: string;
};

const DEFAULTS: Settings = {
  paper_balance: "10000", imessage_target: "", webhook_secret: "",
  risk_per_trade: "2", default_lot_size: "0.1",
  strategy_pairs: "EURUSD,GBPUSD",
  strategy_asian_start: "2", strategy_asian_end: "7",
  strategy_breakout_start: "8", strategy_breakout_end: "10", strategy_close_cutoff: "12",
  strategy_min_range_pips: "15", strategy_max_range_pips: "50",
  strategy_entry_buffer_pips: "2", strategy_tp_multiplier: "1.5",
  strategy_breakeven_r: "1", strategy_trend_filter: "false",
  strategy_max_daily_loss_pct: "3", strategy_max_consec_losses: "3",
  strategy_max_portfolio_heat: "5", strategy_correlation_filter: "true",
};

export default function SettingsPage() {
  const [form, setForm] = useState<Settings>(DEFAULTS);
  const [saved, setSaved]       = useState(false);
  const [copied, setCopied]     = useState(false);
  const [resetting, setReset]   = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => setForm((f) => ({ ...f, ...d })));
  }, []);

  async function handleSave() {
    await fetch("/api/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const set = (key: keyof Settings) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  async function handleReset() {
    if (!window.confirm("This will permanently delete all trades, signals and strategy history. The paper balance will stay at your configured amount. Are you sure?")) return;
    setReset(true);
    await fetch("/api/reset", { method: "POST" });
    setReset(false);
    setResetDone(true);
    setTimeout(() => setResetDone(false), 3000);
  }

  function copyWebhook() {
    navigator.clipboard.writeText(`${window.location.origin}/api/webhook`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>Configure Meridian</p>
      </div>

      {/* Webhook */}
      <Section title="TradingView Webhook">
        <div>
          <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Webhook URL</label>
          <div className="flex items-center gap-2 rounded-xl px-4 py-3 font-mono text-sm"
            style={{ background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.2)" }}>
            <span className="flex-1 truncate" style={{ color: "var(--accent)" }}>
              {typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}/api/webhook
            </span>
            <button onClick={copyWebhook} className="shrink-0 hover:opacity-70">
              {copied ? <CheckCircle size={15} style={{ color: "var(--green)" }} /> : <Copy size={15} style={{ color: "var(--text-muted)" }} />}
            </button>
          </div>
        </div>
        <Field label="Webhook Secret (optional)" value={form.webhook_secret}
          placeholder="Leave blank to allow all" onChange={set("webhook_secret")} />
      </Section>

      {/* Notifications */}
      <Section title="Notifications">
        <Field label="iMessage Target (phone or Apple ID email)" value={form.imessage_target}
          placeholder="+447900000000 or you@icloud.com" onChange={set("imessage_target")} />
        <InfoBox>Meridian sends iMessage alerts for every signal, TP hit, SL hit, and breakeven move.</InfoBox>
      </Section>

      {/* Paper Trading */}
      <Section title="Paper Trading">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Starting Balance (AED)" value={form.paper_balance} type="number" onChange={set("paper_balance")} />
          <Field label="Risk per trade (%)" value={form.risk_per_trade} type="number" onChange={set("risk_per_trade")} />
        </div>
        <InfoBox>Position size is automatically calculated from your balance, risk %, entry, and stop loss distance.</InfoBox>
      </Section>

      {/* London Breakout */}
      <Section title="London Breakout — Session Windows (GMT hours)">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Asian range start" value={form.strategy_asian_start} type="number" onChange={set("strategy_asian_start")} />
          <Field label="Asian range end"   value={form.strategy_asian_end}   type="number" onChange={set("strategy_asian_end")} />
          <Field label="Close cutoff"      value={form.strategy_close_cutoff} type="number" onChange={set("strategy_close_cutoff")} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Breakout window start" value={form.strategy_breakout_start} type="number" onChange={set("strategy_breakout_start")} />
          <Field label="Breakout window end"   value={form.strategy_breakout_end}   type="number" onChange={set("strategy_breakout_end")} />
        </div>
        <InfoBox>All times are GMT. Default: Asian range 02:00–07:00, Breakout 08:00–10:00, Force-close at 12:00.</InfoBox>
      </Section>

      <Section title="London Breakout — Entry Filters">
        <div>
          <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>Pairs to trade</label>
          <div className="flex flex-wrap gap-2">
            {ALL_PAIRS.map((p) => {
              const on = form.strategy_pairs.split(",").map((s) => s.trim().toUpperCase()).includes(p);
              return (
                <button key={p} onClick={() => {
                  const current = form.strategy_pairs.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
                  const next = on ? current.filter((x) => x !== p) : [...current, p];
                  if (next.length) set("strategy_pairs")(next.join(","));
                }}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={{
                    background: on ? `${PAIR_COLORS[p]}18` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${on ? PAIR_COLORS[p] + "55" : "var(--border)"}`,
                    color: on ? PAIR_COLORS[p] : "var(--text-muted)",
                  }}
                >{p.slice(0, 3)}/{p.slice(3)}</button>
              );
            })}
            <button onClick={() => set("strategy_pairs")(ALL_PAIRS.join(","))}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >All</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Min range size (pips)" value={form.strategy_min_range_pips} type="number" onChange={set("strategy_min_range_pips")} />
          <Field label="Max range size (pips)" value={form.strategy_max_range_pips} type="number" onChange={set("strategy_max_range_pips")} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Entry buffer (pips beyond range)" value={form.strategy_entry_buffer_pips} type="number" onChange={set("strategy_entry_buffer_pips")} />
          <Field label="TP multiplier (× range size)" value={form.strategy_tp_multiplier} type="number" onChange={set("strategy_tp_multiplier")} />
        </div>
        <Toggle label="H4 trend filter (only trade with higher-timeframe trend)"
          value={form.strategy_trend_filter === "true"}
          onChange={(v) => set("strategy_trend_filter")(v ? "true" : "false")} />
        <InfoBox>Buffer of 2 pips reduces false breakout entries. TP at 1.5× range gives a positive expected value at 40%+ win rate.</InfoBox>
      </Section>

      <Section title="Loss Minimisation — Risk Guards">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Max daily loss (%)" value={form.strategy_max_daily_loss_pct} type="number" onChange={set("strategy_max_daily_loss_pct")} />
          <Field label="Max consecutive losses" value={form.strategy_max_consec_losses} type="number" onChange={set("strategy_max_consec_losses")} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Max portfolio heat (%)" value={form.strategy_max_portfolio_heat} type="number" onChange={set("strategy_max_portfolio_heat")} />
          <Field label="Breakeven trigger (× R)" value={form.strategy_breakeven_r} type="number" onChange={set("strategy_breakeven_r")} />
        </div>
        <Toggle label="Correlation filter (block same-direction trades on EUR/USD + GBP/USD etc.)"
          value={form.strategy_correlation_filter === "true"}
          onChange={(v) => set("strategy_correlation_filter")(v ? "true" : "false")} />
        <InfoBox>
          Daily loss limit prevents revenge trading. Portfolio heat stops correlated losses from stacking.
          Breakeven at 1R = once a trade moves 1× your risk in profit, the stop moves to entry — the trade is now free.
        </InfoBox>
      </Section>

      <div className="flex items-center gap-3">
        <button onClick={handleSave}
          className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-95"
          style={{ background: saved ? "var(--green)" : "var(--accent)", color: "#000" }}>
          {saved ? <CheckCircle size={16} /> : <Save size={16} />}
          {saved ? "Saved!" : "Save Settings"}
        </button>

        <button onClick={handleReset} disabled={resetting}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-95"
          style={{
            background: resetDone ? "rgba(0,255,136,0.15)" : "rgba(255,51,102,0.12)",
            border: `1px solid ${resetDone ? "rgba(0,255,136,0.3)" : "rgba(255,51,102,0.3)"}`,
            color: resetDone ? "var(--green)" : "var(--red)",
          }}>
          {resetDone ? <CheckCircle size={16} /> : <Trash2 size={16} />}
          {resetDone ? "Reset complete" : resetting ? "Resetting…" : "Reset Paper Account"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5 space-y-4">
      <div className="text-sm font-semibold pb-1" style={{ color: "var(--text-primary)", borderBottom: "1px solid var(--border)" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, placeholder, type = "text", onChange }: {
  label: string; value: string; placeholder?: string; type?: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>{label}</label>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
        onBlur={(e)  => (e.target.style.borderColor = "var(--border)")} />
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
      <button onClick={() => onChange(!value)}
        className="w-10 h-5 rounded-full transition-all relative shrink-0"
        style={{ background: value ? "var(--green)" : "var(--border)" }}>
        <span className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
          style={{ background: "#fff", left: value ? "calc(100% - 18px)" : "2px" }} />
      </button>
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl p-3 text-xs leading-relaxed"
      style={{ background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.15)", color: "var(--text-muted)" }}>
      <Info size={14} className="shrink-0 mt-0.5" style={{ color: "var(--accent)" }} />
      <span>{children}</span>
    </div>
  );
}
