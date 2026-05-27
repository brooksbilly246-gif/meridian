import { clearInsights, upsertInsight, getInsights, getClosedTradesWithSession, getSetting, InsightRow } from "./db";

type TradeRow = {
  pair: string; direction: string;
  pnl: number; pnl_pips: number; open_time: number;
  range_pips: number | null;
};

// Break-even win rate at 1.5× TP = 40%. Thresholds:
// ≥ 55% (5+ trades) → STRONG_EDGE
// ≥ 40%             → OK
// < 40% (3+ trades) → AVOID
// otherwise         → INSUFFICIENT
function rate(wins: number, total: number): InsightRow["rating"] {
  if (total < 3) return "INSUFFICIENT";
  const wr = wins / total;
  if (wr >= 0.55 && total >= 5) return "STRONG_EDGE";
  if (wr >= 0.40) return "OK";
  return "AVOID";
}

function agg(subset: TradeRow[]) {
  const wins    = subset.filter((t) => t.pnl > 0).length;
  const losses  = subset.length - wins;
  const win_rate = subset.length > 0 ? wins / subset.length : 0;
  const avg_pips = subset.length > 0
    ? subset.reduce((s, t) => s + t.pnl_pips, 0) / subset.length
    : 0;
  const net_pnl = subset.reduce((s, t) => s + t.pnl, 0);
  return { trades: subset.length, wins, losses, win_rate, avg_pips, net_pnl };
}

export function computeInsights() {
  const trades = getClosedTradesWithSession() as TradeRow[];
  if (!trades.length) return;

  clearInsights();

  // ── Range buckets ────────────────────────────────────────────────────────
  const BUCKETS = [
    { label: "15–20 pips", min: 15, max: 20, tightKey: "strategy_min_range_pips", tightVal: "20" },
    { label: "20–30 pips", min: 20, max: 30 },
    { label: "30–40 pips", min: 30, max: 40 },
    { label: "40–50 pips", min: 40, max: 50, wideKey: "strategy_max_range_pips", wideVal: "40" },
  ] as { label: string; min: number; max: number; tightKey?: string; tightVal?: string; wideKey?: string; wideVal?: string }[];

  for (const b of BUCKETS) {
    const subset = trades.filter((t) => t.range_pips != null && t.range_pips! >= b.min && t.range_pips! < b.max);
    if (!subset.length) continue;
    const s = agg(subset);
    const rating = rate(s.wins, s.trades);
    let suggestion_key = null, suggestion_value = null, suggestion_reason = null;
    if (rating === "AVOID") {
      if (b.tightKey) {
        suggestion_key = b.tightKey; suggestion_value = b.tightVal ?? null;
        suggestion_reason = `${b.label}: ${s.wins}W/${s.losses}L (${(s.win_rate * 100).toFixed(0)}% win rate) — raising min range removes this losing bucket`;
      } else if (b.wideKey) {
        suggestion_key = b.wideKey; suggestion_value = b.wideVal ?? null;
        suggestion_reason = `${b.label}: ${s.wins}W/${s.losses}L (${(s.win_rate * 100).toFixed(0)}% win rate) — tightening max range removes this losing bucket`;
      }
    }
    upsertInsight({ category: "range_bucket", label: b.label, ...s, rating, suggestion_key, suggestion_value, suggestion_reason });
  }

  // ── Day of week ──────────────────────────────────────────────────────────
  const DAY_NAMES: Record<number, string> = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday" };
  const allowedDays = (getSetting("strategy_allowed_days") || "1,2,3,4")
    .split(",").map((d) => parseInt(d.trim()));

  for (const [dowStr, name] of Object.entries(DAY_NAMES)) {
    const dow = parseInt(dowStr);
    const subset = trades.filter((t) => new Date(t.open_time * 1000).getUTCDay() === dow);
    if (!subset.length) continue;
    const s = agg(subset);
    const rating = rate(s.wins, s.trades);
    let suggestion_key = null, suggestion_value = null, suggestion_reason = null;
    if (rating === "AVOID" && allowedDays.includes(dow) && allowedDays.length > 1) {
      const newDays = allowedDays.filter((d) => d !== dow).join(",");
      suggestion_key = "strategy_allowed_days";
      suggestion_value = newDays;
      suggestion_reason = `${name}: ${s.wins}W/${s.losses}L (${(s.win_rate * 100).toFixed(0)}%) — removing from trading schedule`;
    }
    upsertInsight({ category: "day_of_week", label: name, ...s, rating, suggestion_key, suggestion_value, suggestion_reason });
  }

  // ── Direction ────────────────────────────────────────────────────────────
  for (const dir of ["LONG", "SHORT"]) {
    const subset = trades.filter((t) => t.direction === dir);
    if (!subset.length) continue;
    const s = agg(subset);
    const rating = rate(s.wins, s.trades);
    let suggestion_key = null, suggestion_value = null, suggestion_reason = null;
    if (rating === "AVOID" && dir === "SHORT") {
      suggestion_key = "strategy_trend_filter";
      suggestion_value = "true";
      suggestion_reason = `SHORT trades: ${s.wins}W/${s.losses}L (${(s.win_rate * 100).toFixed(0)}%) — trend filter blocks counter-trend SHORT entries`;
    }
    upsertInsight({ category: "direction", label: dir, ...s, rating, suggestion_key, suggestion_value, suggestion_reason });
  }

  // ── Pair ─────────────────────────────────────────────────────────────────
  const activePairs = (getSetting("strategy_pairs") || "EURUSD,GBPUSD")
    .split(",").map((p) => p.trim().toUpperCase());
  const allPairs = [...new Set(trades.map((t) => t.pair))];

  for (const pair of allPairs) {
    const subset = trades.filter((t) => t.pair === pair);
    if (!subset.length) continue;
    const s = agg(subset);
    const rating = rate(s.wins, s.trades);
    let suggestion_key = null, suggestion_value = null, suggestion_reason = null;
    if (rating === "AVOID" && activePairs.includes(pair) && activePairs.length > 1) {
      const remaining = activePairs.filter((p) => p !== pair).join(",");
      suggestion_key = "strategy_pairs";
      suggestion_value = remaining;
      suggestion_reason = `${pair}: ${s.wins}W/${s.losses}L (${(s.win_rate * 100).toFixed(0)}%) — removing from active pairs`;
    }
    upsertInsight({ category: "pair", label: pair, ...s, rating, suggestion_key, suggestion_value, suggestion_reason });
  }
}

export { getInsights };
