/**
 * MERIDIAN — London Session Breakout (LSB)
 *
 * Phase 1: Asian Range Build (02:00–07:00 GMT)
 * Phase 2: Breakout Detection (08:00–10:00 GMT)
 * Phase 3: Trade Management (SL/TP/breakeven/cutoff)
 *
 * Risk management: circuit breakers, portfolio heat,
 * correlation filter, drawdown scaling. Flattens by session close.
 */

import {
  getSetting,
  getStats,
  getOrCreateRiskState,
  updateRiskState,
  getOrCreateSession,
  updateSession,
  getAllSessions,
  openTrade,
  closeTrade,
  updateTradeStopLoss,
  getOpenTrades,
  insertSignal,
  markSignalExecuted,
  stratLog,
  StrategySession,
} from "./db";
import { runRiskChecks, calcLotSize, scaledLotSize, calcPnl, toPips, fromPips, pipSize } from "./risk";
import { formatAED } from "./currency";
import { notifySetup, sendIMessage } from "./notify";
import { computeInsights } from "./insights";

// ─── Types ────────────────────────────────────────────────────────────────────
type Candle = { time: number; open: number; high: number; low: number; close: number };
type OpenTrade = {
  id: number; pair: string; direction: string;
  entry_price: number; stop_loss: number; take_profit: number;
  lot_size: number; open_time: number; signal_source: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function nowGmt() {
  const d = new Date();
  return {
    hour:    d.getUTCHours(),
    minute:  d.getUTCMinutes(),
    dayOfWeek: d.getUTCDay(),
    dateStr: d.toISOString().split("T")[0],
    hourDecimal: d.getUTCHours() + d.getUTCMinutes() / 60,
  };
}

function candleGmtHour(ts: number): number {
  const d = new Date(ts * 1000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

function candleDateStr(ts: number): string {
  return new Date(ts * 1000).toISOString().split("T")[0];
}

async function fetchCandles(pair: string, interval: string, range: string): Promise<Candle[]> {
  const symbol = `${pair.toUpperCase()}=X`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}&includePrePost=false`;
  try {
    const res  = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return [];
    const ts: number[]    = result.timestamp ?? [];
    const { open, high, low, close } = result.indicators.quote[0];
    return ts
      .map((t, i) => ({ time: t, open: open[i], high: high[i], low: low[i], close: close[i] }))
      .filter((c) => c.open != null && c.close != null);
  } catch (e) {
    stratLog("WARN", `Candle fetch failed for ${pair}: ${e}`);
    return [];
  }
}

// ─── Phase 1: Build Asian range ───────────────────────────────────────────────
async function updateAsianRange(pair: string, today: string, asianStart: number, asianEnd: number) {
  const candles = await fetchCandles(pair, "15m", "5d");
  if (!candles.length) return;

  const asianCandles = candles.filter((c) => {
    const h = candleGmtHour(c.time);
    const d = candleDateStr(c.time);
    return d === today && h >= asianStart && h < asianEnd;
  });

  if (!asianCandles.length) return;

  const high = Math.max(...asianCandles.map((c) => c.high));
  const low  = Math.min(...asianCandles.map((c) => c.low));
  const rangePips = toPips(high, low, pair);

  updateSession(pair, today, { asian_high: high, asian_low: low, range_pips: rangePips });
}

// ─── Phase 2: Detect breakout ───────────────────────────────────────────────
async function checkBreakout(
  pair: string,
  today: string,
  session: StrategySession,
  breakoutStart: number,
  breakoutEnd: number
): Promise<string | null> {
  if (!session.asian_high || !session.asian_low) return "no Asian range yet";
  if (session.signal_fired) return "signal already fired today";

  const candles = await fetchCandles(pair, "15m", "5d");
  if (!candles.length) return "no candle data";

  const breakoutCandles = candles.filter((c) => {
    const h = candleGmtHour(c.time);
    const d = candleDateStr(c.time);
    return d === today && h >= breakoutStart && h < breakoutEnd;
  });

  if (!breakoutCandles.length) return "no candles in breakout window yet";

  const bufferPips   = parseFloat(getSetting("strategy_entry_buffer_pips") || "2");
  const buffer       = fromPips(bufferPips, pair);
  const tpMultiplier = parseFloat(getSetting("strategy_tp_multiplier") || "1.5");
  const rangeSize    = session.asian_high - session.asian_low;
  const riskPct      = parseFloat(getSetting("risk_per_trade") || "1");

  const stats   = getStats();
  const balance = parseFloat(stats.balance);
  const startBal = parseFloat(getSetting("paper_balance") || "10000") / 3.6725;

  for (const c of breakoutCandles) {
    let direction: "LONG" | "SHORT" | null = null;
    let entry: number, sl: number, tp: number;

    if (c.close > session.asian_high + buffer) {
      direction = "LONG";
      entry = session.asian_high + buffer;
      sl    = session.asian_low  - buffer;
      tp    = entry + rangeSize * tpMultiplier;
    } else if (c.close < session.asian_low - buffer) {
      direction = "SHORT";
      entry = session.asian_low  - buffer;
      sl    = session.asian_high + buffer;
      tp    = entry - rangeSize * tpMultiplier;
    }

    if (!direction) continue;

    const risk = runRiskChecks(pair, direction, entry!, sl!, session.asian_high, session.asian_low, today);
    if (!risk.ok) {
      stratLog("RISK", `[${pair}] blocked: ${risk.reason}`, pair);
      updateSession(pair, today, { skipped_reason: risk.reason ?? null });
      return risk.reason ?? "risk check failed";
    }

    if (getSetting("strategy_trend_filter") === "true") {
      const h4Candles = await fetchCandles(pair, "1h", "30d");
      if (h4Candles.length >= 4) {
        const last4  = h4Candles.slice(-4);
        const h4Open = last4[0].open;
        const h4Close = last4[last4.length - 1].close;
        const h4Bull = h4Close > h4Open;
        if (direction === "LONG"  && !h4Bull) {
          const msg = `Trend filter: H4 is bearish, skipping LONG`;
          updateSession(pair, today, { skipped_reason: msg });
          stratLog("RISK", `[${pair}] ${msg}`, pair);
          return msg;
        }
        if (direction === "SHORT" && h4Bull) {
          const msg = `Trend filter: H4 is bullish, skipping SHORT`;
          updateSession(pair, today, { skipped_reason: msg });
          stratLog("RISK", `[${pair}] ${msg}`, pair);
          return msg;
        }
      }
    }

    const bothBroken = breakoutCandles.some((bc) => bc.close < session.asian_low! - buffer)
                    && breakoutCandles.some((bc) => bc.close > session.asian_high! + buffer);
    if (bothBroken) {
      const msg = "Both sides broken (false breakout pattern) — skipping";
      updateSession(pair, today, { skipped_reason: msg });
      stratLog("WARN", `[${pair}] ${msg}`, pair);
      return msg;
    }

    const lot = scaledLotSize(balance, startBal, riskPct, entry!, sl!, pair);

    openTrade({
      pair, direction, entry_price: entry!, stop_loss: sl!, take_profit: tp!,
      lot_size: lot, signal_source: "LONDON_BREAKOUT",
    });

    const sigResult = insertSignal({
      pair, direction, timeframe: "15m",
      entry_price: entry!, stop_loss: sl!, take_profit: tp!,
    });
    markSignalExecuted(Number(sigResult.lastInsertRowid));

    updateSession(pair, today, { signal_fired: 1, breakout_direction: direction });

    notifySetup({ pair, direction, entry_price: entry!, window: "15m" });
    const emoji = direction === "LONG" ? "📈" : "📉";
    sendIMessage(
      `${emoji} MERIDIAN — BREAKOUT\n${pair} ${direction}\nEntry: ${entry!.toFixed(5)} | SL: ${sl!.toFixed(5)} | TP: ${tp!.toFixed(5)}\nRange: ${toPips(session.asian_high, session.asian_low, pair).toFixed(1)} pips | Lot: ${lot}\nRisk: ${formatAED(balance * (riskPct / 100))}`
    );
    stratLog("SIGNAL", `[${pair}] ${direction} @ ${entry!.toFixed(5)} SL:${sl!.toFixed(5)} TP:${tp!.toFixed(5)} lot:${lot}`, pair);

    return null;
  }

  return "no confirmed breakout candle yet";
}

// ─── Trade Management ───────────────────────────────────────────────────────
async function manageOpenTrades(today: string, cutoffHour: number) {
  const openTrades = getOpenTrades() as OpenTrade[];
  if (!openTrades.length) return;

  const { hourDecimal } = nowGmt();
  const riskState = getOrCreateRiskState(today);

  for (const trade of openTrades) {
    const pair = trade.pair.replace("/", "");
    const candles = await fetchCandles(pair, "15m", "5d");
    if (!candles.length) continue;

    const closedCandles = candles.filter((c) => {
      const h = candleGmtHour(c.time);
      return candleDateStr(c.time) === today && h < hourDecimal - 0.25;
    });
    if (!closedCandles.length) continue;

    const latest = closedCandles[closedCandles.length - 1];
    const isLong = trade.direction === "LONG";

    const slHit = isLong
      ? latest.low  <= trade.stop_loss
      : latest.high >= trade.stop_loss;

    const tpHit = trade.take_profit
      ? (isLong ? latest.high >= trade.take_profit : latest.low <= trade.take_profit)
      : false;

    const cutoffHit = hourDecimal >= cutoffHour;

    if (slHit && !tpHit) {
      const closePrice = trade.stop_loss;
      const { pnl, pips } = calcPnl(trade.direction, trade.entry_price, closePrice, trade.lot_size, pair);
      closeTrade(trade.id, closePrice, pnl, pips);
      const newConsec = riskState.consecutive_losses + 1;
      updateRiskState(today, {
        daily_pnl: riskState.daily_pnl + pnl,
        daily_trades: riskState.daily_trades + 1,
        consecutive_losses: newConsec,
      });
      sendIMessage(`🔴 MERIDIAN — SL HIT\n${trade.pair} ${trade.direction}\nLoss: ${formatAED(pnl)} (${pips.toFixed(1)} pips)\nConsecutive losses: ${newConsec}`);
      stratLog("TRADE", `[${trade.pair}] SL hit — P&L ${formatAED(pnl)} | ${pips.toFixed(1)} pips`, trade.pair);
      try { computeInsights(); } catch { /* non-blocking */ }
    } else if (tpHit) {
      const closePrice = trade.take_profit;
      const { pnl, pips } = calcPnl(trade.direction, trade.entry_price, closePrice, trade.lot_size, pair);
      closeTrade(trade.id, closePrice, pnl, pips);
      updateRiskState(today, {
        daily_pnl: riskState.daily_pnl + pnl,
        daily_trades: riskState.daily_trades + 1,
        consecutive_losses: 0,
      });
      sendIMessage(`✅ MERIDIAN — TP HIT\n${trade.pair} ${trade.direction}\nProfit: ${formatAED(pnl, { sign: true })} (+${pips.toFixed(1)} pips)`);
      stratLog("TRADE", `[${trade.pair}] TP hit — P&L ${formatAED(pnl, { sign: true })} | +${pips.toFixed(1)} pips`, trade.pair);
      try { computeInsights(); } catch { /* non-blocking */ }
    } else if (cutoffHit) {
      const closePrice = latest.close;
      const { pnl, pips } = calcPnl(trade.direction, trade.entry_price, closePrice, trade.lot_size, pair);
      closeTrade(trade.id, closePrice, pnl, pips);
      const newConsec = pnl < 0 ? riskState.consecutive_losses + 1 : 0;
      updateRiskState(today, {
        daily_pnl: riskState.daily_pnl + pnl,
        daily_trades: riskState.daily_trades + 1,
        consecutive_losses: newConsec,
      });
      const icon = pnl >= 0 ? "✅" : "🟡";
      sendIMessage(`${icon} MERIDIAN — TIME CUTOFF\n${trade.pair} ${trade.direction} closed at ${cutoffHour}:00 GMT\nP&L: ${formatAED(pnl, { sign: true })}`);
      stratLog("TRADE", `[${trade.pair}] Time cutoff close — P&L ${formatAED(pnl, { sign: true })}`, trade.pair);
      try { computeInsights(); } catch { /* non-blocking */ }
    } else {
      // Breakeven rule
      const breakevenR  = parseFloat(getSetting("strategy_breakeven_r") || "1");
      const riskPips    = toPips(trade.entry_price, trade.stop_loss, pair);
      const targetPips  = riskPips * breakevenR;
      const currentPips = isLong
        ? (latest.close - trade.entry_price) / pipSize(pair)
        : (trade.entry_price - latest.close) / pipSize(pair);

      const slAlreadyAtEntry = Math.abs(trade.stop_loss - trade.entry_price) < pipSize(pair) * 2;
      if (currentPips >= targetPips && !slAlreadyAtEntry) {
        updateTradeStopLoss(trade.id, trade.entry_price);
        sendIMessage(`🔐 MERIDIAN — BREAKEVEN\n${trade.pair} ${trade.direction}\nSL moved to entry at ${trade.entry_price.toFixed(5)} (${currentPips.toFixed(1)} pips in profit)`);
        stratLog("TRADE", `[${trade.pair}] Breakeven triggered — SL moved to ${trade.entry_price.toFixed(5)}`, trade.pair);
      }
    }
  }
}

// ─── Main tick ────────────────────────────────────────────────────────────────
export type TickResult = {
  time: string;
  phase: string;
  pairs: { pair: string; status: string }[];
  riskState: { daily_pnl: number; consecutive_losses: number; circuit_broken: number };
};

export async function runStrategyTick(): Promise<TickResult> {
  const enabled = getSetting("strategy_enabled");
  if (enabled !== "true") {
    return { time: new Date().toISOString(), phase: "DISABLED", pairs: [], riskState: { daily_pnl: 0, consecutive_losses: 0, circuit_broken: 0 } };
  }

  const { hourDecimal, dateStr, dayOfWeek } = nowGmt();

  const isWeekend =
    dayOfWeek === 6 ||
    (dayOfWeek === 0 && hourDecimal < 22) ||
    (dayOfWeek === 5 && hourDecimal >= 22);

  if (isWeekend) {
    return { time: new Date().toISOString(), phase: "MARKET_CLOSED", pairs: [], riskState: { daily_pnl: 0, consecutive_losses: 0, circuit_broken: 0 } };
  }

  const asianStart    = parseFloat(getSetting("strategy_asian_start")    || "2");
  const asianEnd      = parseFloat(getSetting("strategy_asian_end")      || "7");
  const breakoutStart = parseFloat(getSetting("strategy_breakout_start") || "8");
  const breakoutEnd   = parseFloat(getSetting("strategy_breakout_end")   || "10");
  const cutoffHour    = parseFloat(getSetting("strategy_close_cutoff")   || "12");
  const pairs         = (getSetting("strategy_pairs") || "EURUSD,GBPUSD")
                          .split(",").map((p) => p.trim().toUpperCase());

  const riskState = getOrCreateRiskState(dateStr);

  // Determine current phase
  let phase = "IDLE";
  if (hourDecimal >= asianStart && hourDecimal < asianEnd) phase = "ASIAN_RANGE";
  else if (hourDecimal >= breakoutStart && hourDecimal < breakoutEnd) phase = "BREAKOUT_WATCH";
  else if (hourDecimal >= breakoutEnd && hourDecimal < cutoffHour) phase = "MANAGING";
  else if (hourDecimal >= cutoffHour) phase = "CLOSED";

  const results: { pair: string; status: string }[] = [];

  for (const pair of pairs) {
    getOrCreateSession(pair, dateStr);
    const session = getOrCreateSession(pair, dateStr);

    if (phase === "ASIAN_RANGE" || phase === "BREAKOUT_WATCH") {
      await updateAsianRange(pair, dateStr, asianStart, asianEnd);
    }

    if (phase === "BREAKOUT_WATCH") {
      const skipReason = await checkBreakout(pair, dateStr, session, breakoutStart, breakoutEnd);
      results.push({ pair, status: skipReason ?? "SIGNAL FIRED" });
    } else {
      const rangeStr = session.asian_high
        ? `range ${session.range_pips?.toFixed(1)}p (${session.asian_low?.toFixed(5)}–${session.asian_high?.toFixed(5)})`
        : "building range";
      results.push({ pair, status: `${phase} — ${rangeStr}` });
    }
  }

  await manageOpenTrades(dateStr, cutoffHour);

  stratLog("INFO", `Tick complete — phase: ${phase}`);

  return {
    time: new Date().toISOString(),
    phase,
    pairs: results,
    riskState: {
      daily_pnl:          riskState.daily_pnl,
      consecutive_losses: riskState.consecutive_losses,
      circuit_broken:     riskState.circuit_broken,
    },
  };
}
