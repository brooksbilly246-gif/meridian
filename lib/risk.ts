/**
 * KAIROS FX — Risk Management Module
 *
 * Loss-minimisation principles implemented here:
 *
 * 1. Fixed fractional position sizing — never risk > N% of balance per trade.
 *    Ensures 100 consecutive max-loss trades cannot blow the account.
 *
 * 2. Daily loss circuit breaker — if daily drawdown exceeds X%, all new
 *    entries are blocked for the rest of the session. Prevents "revenge" spirals.
 *
 * 3. Consecutive loss circuit breaker — after N losses in a row, the engine
 *    pauses. Forces reflection before re-engaging.
 *
 * 4. Portfolio heat limit — total risk across all open positions is capped.
 *    Prevents correlated trades from magnifying a single-direction loss.
 *
 * 5. Correlation filter — EUR/USD and GBP/USD move together ~80% of the time.
 *    Taking both long simultaneously doubles directional exposure.
 *
 * 6. Drawdown-scaled position sizing — after >5% account drawdown, position
 *    sizes are reduced proportionally until the account recovers.
 *
 * 7. Range sanity filter — if the Asian range is too tight or too wide, the
 *    signal is skipped. Tiny ranges → whipsaw. Giant ranges → SL too large.
 *
 * 8. Breakeven rule — once a trade moves 1R in profit, SL moves to entry.
 *    This converts a potential loser into a free trade.
 *
 * 9. Time cutoff — any open trade is force-closed at 12:00 GMT. London
 *    momentum dies after this; holding longer adds noise, not edge.
 *
 * 10. Day-of-week filter — Friday excluded. Institutional desks square
 *     positions before the weekend → unpredictable reversals, thin liquidity.
 */

import {
  getSetting, getStats, getOpenTrades, getOrCreateRiskState, stratLog
} from "./db";

export type RiskCheck = { ok: boolean; reason?: string };

// ─── Pip utilities ───────────────────────────────────────────────────────────

export function pipSize(pair: string): number {
  return pair.toUpperCase().includes("JPY") ? 0.01 : 0.0001;
}

export function toPips(price1: number, price2: number, pair: string): number {
  return Math.abs(price1 - price2) / pipSize(pair);
}

export function fromPips(pips: number, pair: string): number {
  return pips * pipSize(pair);
}

// ─── Position sizing ─────────────────────────────────────────────────────────

export function calcLotSize(
  balance: number,
  riskPct: number,
  entryPrice: number,
  stopLoss: number,
  pair: string
): number {
  const riskAmount  = balance * (riskPct / 100);
  const stopPips    = toPips(entryPrice, stopLoss, pair);
  if (stopPips === 0) return 0.01;
  // Standard lot = 100,000 units; pip value ≈ $10/lot for non-JPY, ~$6.5/lot for JPY
  const pipValuePerLot = pair.toUpperCase().includes("JPY") ? 6.5 : 10;
  const rawLot = riskAmount / (stopPips * pipValuePerLot);
  // Clamp to 0.01–10, round to 2 dp
  return Math.min(Math.max(0.01, parseFloat(rawLot.toFixed(2))), 10);
}

// Drawdown-scaled sizing: if account has drawn down, reduce size
export function scaledLotSize(
  balance: number,
  startingBalance: number,
  riskPct: number,
  entryPrice: number,
  stopLoss: number,
  pair: string
): number {
  const drawdownPct = ((startingBalance - balance) / startingBalance) * 100;
  // At 5% drawdown → use 80% of normal size
  // At 10% drawdown → use 60% of normal size
  // At 15% drawdown → use 40% of normal size
  let scalar = 1;
  if (drawdownPct >= 15) scalar = 0.4;
  else if (drawdownPct >= 10) scalar = 0.6;
  else if (drawdownPct >= 5)  scalar = 0.8;

  const base = calcLotSize(balance, riskPct, entryPrice, stopLoss, pair);
  return Math.max(0.01, parseFloat((base * scalar).toFixed(2)));
}

// ─── P&L calculation ─────────────────────────────────────────────────────────

export function calcPnl(
  direction: string,
  entryPrice: number,
  closePrice: number,
  lotSize: number,
  pair: string
): { pnl: number; pips: number } {
  const pips = direction === "LONG"
    ? (closePrice - entryPrice) / pipSize(pair)
    : (entryPrice - closePrice) / pipSize(pair);
  const pipValuePerLot = pair.toUpperCase().includes("JPY") ? 6.5 : 10;
  const pnl = pips * pipValuePerLot * lotSize;
  return { pnl: parseFloat(pnl.toFixed(2)), pips: parseFloat(pips.toFixed(1)) };
}

// ─── Correlation groups ───────────────────────────────────────────────────────
// Pairs that move together — trading two from the same group doubles exposure.
const CORR_GROUPS: string[][] = [
  ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD"],  // USD-strength sensitive (positive)
  ["USDCHF", "USDJPY", "USDCAD"],             // USD-strength sensitive (inverse)
];

export function correlatedPairExists(newPair: string, newDirection: string): boolean {
  const openTrades = getOpenTrades() as { pair: string; direction: string }[];
  if (!openTrades.length) return false;

  for (const group of CORR_GROUPS) {
    if (!group.includes(newPair)) continue;

    for (const trade of openTrades) {
      const tradePair = trade.pair.replace("/", "");
      if (!group.includes(tradePair) || tradePair === newPair) continue;

      // Both pairs in same group, same direction = correlated concentration
      if (trade.direction === newDirection) {
        stratLog("RISK", `Correlation block: ${newPair} ${newDirection} conflicts with open ${tradePair} ${trade.direction}`);
        return true;
      }
    }
  }
  return false;
}

// ─── Portfolio heat ───────────────────────────────────────────────────────────
// Total risk (in %) currently locked in open trades
export function currentPortfolioHeat(balance: number, pair: string): number {
  const openTrades = getOpenTrades() as { entry_price: number; stop_loss: number; lot_size: number; pair: string }[];
  let totalRiskAmount = 0;

  for (const t of openTrades) {
    if (!t.stop_loss) continue;
    const p = toPips(t.entry_price, t.stop_loss, t.pair);
    const pvPerLot = t.pair.toUpperCase().includes("JPY") ? 6.5 : 10;
    totalRiskAmount += p * pvPerLot * t.lot_size;
  }

  return (totalRiskAmount / balance) * 100;
}

// ─── Master risk gate ─────────────────────────────────────────────────────────
// All checks in one place — strategy calls this before opening any trade.
export function runRiskChecks(
  pair: string,
  direction: string,
  entryPrice: number,
  stopLoss: number,
  rangeHigh: number,
  rangeLow: number,
  today: string
): RiskCheck {
  const stats        = getStats();
  const balance      = parseFloat(stats.balance);
  const startBalance = parseFloat(getSetting("paper_balance") || "10000");
  const riskState    = getOrCreateRiskState(today);

  // 1. Circuit breaker: daily loss limit
  const maxDailyLossPct = parseFloat(getSetting("strategy_max_daily_loss_pct") || "3");
  const dailyLossPct    = (riskState.daily_pnl / startBalance) * 100;
  if (dailyLossPct <= -maxDailyLossPct) {
    return { ok: false, reason: `Daily loss limit reached (${dailyLossPct.toFixed(2)}% / -${maxDailyLossPct}%)` };
  }

  // 2. Circuit breaker: consecutive losses
  const maxConsec = parseInt(getSetting("strategy_max_consec_losses") || "3");
  if (riskState.consecutive_losses >= maxConsec) {
    return { ok: false, reason: `Consecutive loss limit (${riskState.consecutive_losses} / ${maxConsec})` };
  }

  // 3. Day of week filter
  const allowedDays = (getSetting("strategy_allowed_days") || "1,2,3,4")
    .split(",").map((d) => parseInt(d.trim()));
  const dayOfWeek = new Date().getUTCDay(); // 0=Sun,1=Mon...6=Sat
  if (!allowedDays.includes(dayOfWeek)) {
    return { ok: false, reason: `Day ${dayOfWeek} not in allowed days [${allowedDays.join(",")}]` };
  }

  // 4. Range size filter
  const minPips = parseFloat(getSetting("strategy_min_range_pips") || "15");
  const maxPips = parseFloat(getSetting("strategy_max_range_pips") || "50");
  const rangePips = toPips(rangeHigh, rangeLow, pair);
  if (rangePips < minPips) {
    return { ok: false, reason: `Range too tight: ${rangePips.toFixed(1)} pips (min ${minPips})` };
  }
  if (rangePips > maxPips) {
    return { ok: false, reason: `Range too wide: ${rangePips.toFixed(1)} pips (max ${maxPips})` };
  }

  // 5. Portfolio heat
  const maxHeat  = parseFloat(getSetting("strategy_max_portfolio_heat") || "5");
  const riskPct  = parseFloat(getSetting("risk_per_trade") || "1");
  const heat     = currentPortfolioHeat(balance, pair);
  if (heat + riskPct > maxHeat) {
    return { ok: false, reason: `Portfolio heat too high: ${heat.toFixed(2)}% + ${riskPct}% > ${maxHeat}%` };
  }

  // 6. Correlation filter
  if (getSetting("strategy_correlation_filter") === "true") {
    if (correlatedPairExists(pair, direction)) {
      return { ok: false, reason: `Correlated position already open in same direction` };
    }
  }

  // 7. Drawdown guard: hard stop at 20%
  const drawdownPct = ((startBalance - balance) / startBalance) * 100;
  if (drawdownPct >= 20) {
    return { ok: false, reason: `Hard drawdown limit hit: -${drawdownPct.toFixed(1)}%` };
  }

  return { ok: true };
}
