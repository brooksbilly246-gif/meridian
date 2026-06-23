import {
  pipSize, toPips, fromPips,
  calcLotSize, scaledLotSize, calcPnl,
  correlatedPairExists, currentPortfolioHeat, runRiskChecks,
} from "@/lib/risk";
import {
  getDb, getSetting, setSetting,
  getOrCreateSession, updateSession, getAllSessions,
  getOrCreateRiskState, updateRiskState,
  openTrade, closeTrade, updateTradeStopLoss,
  getOpenTrades, getAllTrades,
  stratLog, getStrategyLog,
} from "@/lib/db";

type TestResult = { name: string; ok: boolean; detail: string };

function test(name: string, fn: () => { ok: boolean; detail: string }): TestResult {
  try {
    const r = fn();
    return { name, ...r };
  } catch (e) {
    return { name, ok: false, detail: `THREW: ${e}` };
  }
}

function eq(a: unknown, b: unknown, label = ""): { ok: boolean; detail: string } {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  return { ok, detail: ok ? `${label}${a}` : `expected ${b}, got ${a}` };
}

function approx(a: number, b: number, tol = 0.01): { ok: boolean; detail: string } {
  const ok = Math.abs(a - b) <= tol;
  return { ok, detail: ok ? `${a} ≈ ${b}` : `expected ≈${b}, got ${a}` };
}

async function fetchCandlesLocal(pair: string, interval: string, range: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${pair}=X?interval=${interval}&range=${range}&includePrePost=false`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return [];
  const ts: number[] = result.timestamp ?? [];
  const { open, high, low, close } = result.indicators.quote[0];
  return ts.map((t, i) => ({ time: t, open: open[i], high: high[i], low: low[i], close: close[i] }))
           .filter((c) => c.open != null);
}

export async function GET() {
  const results: TestResult[] = [];
  const today = new Date().toISOString().split("T")[0];
  const db = getDb();

  // Wrap ALL db-writing tests in a savepoint so nothing persists to the live account.
  db.exec("SAVEPOINT test_suite");

  // ── 1. Pip size ─────────────────────────────────────────────────────────────
  results.push(test("pipSize EURUSD = 0.0001", () => eq(pipSize("EURUSD"), 0.0001)));
  results.push(test("pipSize USDJPY = 0.01",   () => eq(pipSize("USDJPY"), 0.01)));

  // ── 2. toPips / fromPips ────────────────────────────────────────────────────
  results.push(test("toPips EURUSD 50 pips",
    () => approx(toPips(1.1050, 1.1000, "EURUSD"), 50)));
  results.push(test("toPips USDJPY 50 pips",
    () => approx(toPips(150.50, 150.00, "USDJPY"), 50)));
  results.push(test("fromPips EURUSD 20 pips = 0.0020",
    () => approx(fromPips(20, "EURUSD"), 0.002, 0.000001)));

  // ── 3. Position sizing ──────────────────────────────────────────────────────
  // $10,000 balance, 1% risk = $100, 50 pip stop, $10/pip/lot → 0.20 lots
  results.push(test("calcLotSize: 1% of $10k, 50-pip stop",
    () => approx(calcLotSize(10000, 1, 1.1050, 1.1000, "EURUSD"), 0.20, 0.01)));

  // $10,000 balance, 2% risk = $200, 20-pip stop → 1.00 lot
  results.push(test("calcLotSize: 2% of $10k, 20-pip stop",
    () => approx(calcLotSize(10000, 2, 1.1020, 1.1000, "EURUSD"), 1.00, 0.05)));

  // ── 4. Drawdown-scaled sizing ───────────────────────────────────────────────
  // 0% drawdown → same as normal
  results.push(test("scaledLotSize: 0% drawdown = full size",
    () => approx(
      scaledLotSize(10000, 10000, 1, 1.1050, 1.1000, "EURUSD"),
      calcLotSize(10000, 1, 1.1050, 1.1000, "EURUSD"),
      0.01)));
  // 10% drawdown → 60% of normal
  results.push(test("scaledLotSize: 10% drawdown = 60% of full size", () => {
    const full   = calcLotSize(9000, 1, 1.1050, 1.1000, "EURUSD");
    const scaled = scaledLotSize(9000, 10000, 1, 1.1050, 1.1000, "EURUSD");
    return approx(scaled / full, 0.6, 0.02);
  }));
  // 15% drawdown → 40% of normal
  results.push(test("scaledLotSize: 15% drawdown = 40% of full size", () => {
    const full   = calcLotSize(8500, 1, 1.1050, 1.1000, "EURUSD");
    const scaled = scaledLotSize(8500, 10000, 1, 1.1050, 1.1000, "EURUSD");
    return approx(scaled / full, 0.4, 0.02);
  }));

  // ── 5. P&L calculation ──────────────────────────────────────────────────────
  // Standard lot pip value: $10/pip/lot internally (displayed as AED). 0.1 lot = $1/pip.
  // 50 pips × $10/lot × 0.1 lot = $50 USD
  results.push(test("calcPnl LONG win: 50 pips × 0.1 lot = +50 USD", () => {
    const { pnl, pips } = calcPnl("LONG", 1.1000, 1.1050, 0.1, "EURUSD");
    return {
      ok: Math.abs(pnl - 50) < 0.5 && Math.abs(pips - 50) < 1,
      detail: `pnl=${pnl} pips=${pips}`,
    };
  }));
  // 30 pips × $10/lot × 0.1 lot = $30 USD
  results.push(test("calcPnl SHORT win: 30 pips × 0.1 lot = +30 USD", () => {
    const { pnl, pips } = calcPnl("SHORT", 1.1030, 1.1000, 0.1, "EURUSD");
    return {
      ok: Math.abs(pnl - 30) < 0.5 && Math.abs(pips - 30) < 1,
      detail: `pnl=${pnl} pips=${pips}`,
    };
  }));
  // 20 pips × $10/lot × 0.1 lot = $20 USD loss
  results.push(test("calcPnl LONG loss: -20 pips × 0.1 lot = -20 USD", () => {
    const { pnl, pips } = calcPnl("LONG", 1.1000, 1.0980, 0.1, "EURUSD");
    return {
      ok: pnl < 0 && Math.abs(pnl + 20) < 0.5,
      detail: `pnl=${pnl} pips=${pips}`,
    };
  }));

  // ── 6. Database: session management ─────────────────────────────────────────
  results.push(test("DB: create strategy session", () => {
    const s = getOrCreateSession("EURUSD", today);
    return { ok: s.pair === "EURUSD" && s.session_date === today, detail: `pair=${s.pair} date=${s.session_date}` };
  }));
  results.push(test("DB: update session asian range", () => {
    updateSession("EURUSD", today, { asian_high: 1.1050, asian_low: 1.1000, range_pips: 50 });
    const s = getOrCreateSession("EURUSD", today);
    return {
      ok: s.asian_high === 1.1050 && s.asian_low === 1.1000 && s.range_pips === 50,
      detail: `H=${s.asian_high} L=${s.asian_low} range=${s.range_pips}`,
    };
  }));
  results.push(test("DB: mark session signal fired", () => {
    updateSession("EURUSD", today, { signal_fired: 1, breakout_direction: "LONG" });
    const s = getOrCreateSession("EURUSD", today);
    return { ok: s.signal_fired === 1 && s.breakout_direction === "LONG", detail: `fired=${s.signal_fired} dir=${s.breakout_direction}` };
  }));
  // reset for later tests
  updateSession("EURUSD", today, { signal_fired: 0, breakout_direction: null, skipped_reason: null });

  // ── 7. Database: risk state ──────────────────────────────────────────────────
  results.push(test("DB: create risk state", () => {
    const r = getOrCreateRiskState(today);
    return { ok: r.date === today, detail: `date=${r.date} pnl=${r.daily_pnl}` };
  }));
  results.push(test("DB: update risk state consecutive losses", () => {
    updateRiskState(today, { consecutive_losses: 2 });
    const r = getOrCreateRiskState(today);
    return { ok: r.consecutive_losses === 2, detail: `consecutive_losses=${r.consecutive_losses}` };
  }));
  updateRiskState(today, { consecutive_losses: 0, daily_pnl: 0 }); // reset

  // ── 8. Database: strategy log ────────────────────────────────────────────────
  results.push(test("DB: write and read strategy log", () => {
    stratLog("INFO", "TEST_ENTRY_MERIDIAN", "EURUSD");
    const log = getStrategyLog(5);
    const found = log.some((e) => e.message === "TEST_ENTRY_MERIDIAN");
    return { ok: found, detail: found ? "log entry found" : "log entry missing" };
  }));

  // ── 9. Trade lifecycle ───────────────────────────────────────────────────────
  const tradeResult = openTrade({
    pair: "TESTPAIR", direction: "LONG",
    entry_price: 1.1000, stop_loss: 1.0950, take_profit: 1.1075,
    lot_size: 0.2, signal_source: "LONDON_BREAKOUT",
  });
  const tradeId = Number(tradeResult.lastInsertRowid);

  results.push(test("DB: open trade", () => {
    const open = getOpenTrades() as { id: number; pair: string; direction: string }[];
    const found = open.find((t) => t.id === tradeId);
    return { ok: !!found, detail: found ? `trade #${tradeId} ${found.pair} ${found.direction}` : "not found" };
  }));

  results.push(test("DB: move stop to breakeven", () => {
    updateTradeStopLoss(tradeId, 1.1000);
    const open = getOpenTrades() as { id: number; stop_loss: number }[];
    const t = open.find((t) => t.id === tradeId);
    return { ok: t?.stop_loss === 1.1000, detail: `new SL=${t?.stop_loss}` };
  }));

  results.push(test("DB: close trade with P&L", () => {
    closeTrade(tradeId, 1.1075, 15.00, 75);
    const all = getAllTrades(10) as { id: number; status: string; pnl: number }[];
    const t = all.find((t) => t.id === tradeId);
    return {
      ok: t?.status === "CLOSED" && t.pnl === 15,
      detail: `status=${t?.status} pnl=${t?.pnl}`,
    };
  }));

  // ── 10. Risk gates ───────────────────────────────────────────────────────────
  // Day filter: Saturday (day 6) should be blocked
  results.push(test("Risk: day filter blocks Saturday", () => {
    // Temporarily set allowed days to exclude today's day
    const origDays = getSetting("strategy_allowed_days");
    setSetting("strategy_allowed_days", "9"); // day 9 never exists
    const r = runRiskChecks("EURUSD", "LONG", 1.1050, 1.1000, 1.1050, 1.1000, today);
    setSetting("strategy_allowed_days", origDays);
    return { ok: !r.ok && r.reason!.includes("Day"), detail: r.reason ?? "no reason" };
  }));

  // Range size: too small — override day filter so range check runs
  results.push(test("Risk: range < min pips blocked", () => {
    const origMin  = getSetting("strategy_min_range_pips");
    const origDays = getSetting("strategy_allowed_days");
    setSetting("strategy_min_range_pips", "50");
    setSetting("strategy_allowed_days", "0,1,2,3,4,5,6"); // allow all days
    // Range of 1.1005-1.1000 = 5 pips → blocked by range filter
    const r = runRiskChecks("EURUSD", "LONG", 1.1005, 1.1000, 1.1005, 1.1000, today);
    setSetting("strategy_min_range_pips", origMin);
    setSetting("strategy_allowed_days", origDays);
    return { ok: !r.ok && r.reason!.includes("tight"), detail: r.reason ?? "no reason" };
  }));

  // Range size: too large — same fix
  results.push(test("Risk: range > max pips blocked", () => {
    const origMax  = getSetting("strategy_max_range_pips");
    const origDays = getSetting("strategy_allowed_days");
    setSetting("strategy_max_range_pips", "10");
    setSetting("strategy_allowed_days", "0,1,2,3,4,5,6");
    // Range of 1.1050-1.1000 = 50 pips → blocked by range filter with max=10
    const r = runRiskChecks("EURUSD", "LONG", 1.1050, 1.1000, 1.1050, 1.1000, today);
    setSetting("strategy_max_range_pips", origMax);
    setSetting("strategy_allowed_days", origDays);
    return { ok: !r.ok && r.reason!.includes("wide"), detail: r.reason ?? "no reason" };
  }));

  // Daily loss circuit breaker
  results.push(test("Risk: daily loss circuit breaker", () => {
    const orig = getSetting("strategy_max_daily_loss_pct");
    setSetting("strategy_max_daily_loss_pct", "1");
    updateRiskState(today, { daily_pnl: -200 }); // -200 on $10k = -2%
    const r = runRiskChecks("EURUSD", "LONG", 1.1050, 1.1000, 1.1050, 1.1000, today);
    setSetting("strategy_max_daily_loss_pct", orig);
    updateRiskState(today, { daily_pnl: 0 });
    return { ok: !r.ok && r.reason!.includes("Daily loss"), detail: r.reason ?? "no reason" };
  }));

  // Consecutive loss breaker
  results.push(test("Risk: consecutive loss circuit breaker", () => {
    updateRiskState(today, { consecutive_losses: 5 });
    const r = runRiskChecks("EURUSD", "LONG", 1.1050, 1.1000, 1.1050, 1.1000, today);
    updateRiskState(today, { consecutive_losses: 0 });
    return { ok: !r.ok && r.reason!.includes("Consecutive"), detail: r.reason ?? "no reason" };
  }));

  // ── 11. Correlation filter ───────────────────────────────────────────────────
  results.push(test("Risk: correlation — no open trades → not blocked", () => {
    // Close all TESTPAIR trades already; check with a real pair
    const blocked = correlatedPairExists("EURUSD", "LONG");
    return { ok: !blocked, detail: blocked ? "incorrectly blocked" : "correctly allowed" };
  }));

  // Open a EURUSD LONG, then check GBPUSD LONG → should be blocked
  const corrTradeResult = openTrade({
    pair: "EURUSD", direction: "LONG",
    entry_price: 1.1000, stop_loss: 1.0950, take_profit: 1.1075,
    lot_size: 0.1, signal_source: "LONDON_BREAKOUT",
  });
  const corrTradeId = Number(corrTradeResult.lastInsertRowid);

  results.push(test("Risk: correlation — EURUSD LONG open → GBPUSD LONG blocked", () => {
    setSetting("strategy_correlation_filter", "true");
    const blocked = correlatedPairExists("GBPUSD", "LONG");
    return { ok: blocked, detail: blocked ? "correctly blocked" : "should have been blocked" };
  }));

  results.push(test("Risk: correlation — EURUSD LONG open → GBPUSD SHORT allowed", () => {
    const blocked = correlatedPairExists("GBPUSD", "SHORT");
    return { ok: !blocked, detail: blocked ? "incorrectly blocked" : "correctly allowed" };
  }));
  closeTrade(corrTradeId, 1.1075, 12.5, 75); // clean up

  // ── 12. Yahoo Finance connectivity ──────────────────────────────────────────
  results.push(await (async () => {
    try {
      const candles = await fetchCandlesLocal("EURUSD", "15m", "5d");
      const ok = candles.length > 50;
      return { name: "Yahoo Finance: EURUSD 15m data", ok, detail: `${candles.length} candles returned` };
    } catch (e) {
      return { name: "Yahoo Finance: EURUSD 15m data", ok: false, detail: String(e) };
    }
  })());

  // ── 13. Asian range from real candles ────────────────────────────────────────
  results.push(await (async () => {
    try {
      const candles = await fetchCandlesLocal("EURUSD", "15m", "5d");
      // Pick any available date and check that Asian range calc returns sane values
      if (!candles.length) return { name: "Asian range from real data", ok: false, detail: "no candles" };

      const dates = [...new Set(candles.map((c) => new Date(c.time * 1000).toISOString().split("T")[0]))];
      const testDate = dates[Math.max(0, dates.length - 2)]; // second-to-last full day

      const asianCandles = candles.filter((c) => {
        const h = new Date(c.time * 1000).getUTCHours() + new Date(c.time * 1000).getUTCMinutes() / 60;
        return new Date(c.time * 1000).toISOString().split("T")[0] === testDate && h >= 2 && h < 7;
      });

      if (!asianCandles.length) return { name: "Asian range from real data", ok: false, detail: `no Asian candles for ${testDate}` };

      const high = Math.max(...asianCandles.map((c) => c.high));
      const low  = Math.min(...asianCandles.map((c) => c.low));
      const pips = toPips(high, low, "EURUSD");
      const ok   = high > low && pips > 0 && pips < 200;

      return {
        name: "Asian range from real data",
        ok,
        detail: `${testDate}: H=${high.toFixed(5)} L=${low.toFixed(5)} range=${pips.toFixed(1)}pips (${asianCandles.length} candles)`,
      };
    } catch (e) {
      return { name: "Asian range from real data", ok: false, detail: String(e) };
    }
  })());

  // ── 14. Strategy tick (full run) ─────────────────────────────────────────────
  results.push(await (async () => {
    try {
      setSetting("strategy_enabled", "true");
      const resp = await fetch("http://localhost:3000/api/strategy/tick", { method: "POST" });
      const data = await resp.json();
      setSetting("strategy_enabled", "false");
      const ok = typeof data.phase === "string" && Array.isArray(data.pairs) && typeof data.riskState === "object";
      return {
        name: "Full strategy tick (end-to-end)",
        ok,
        detail: `phase=${data.phase} pairs=${data.pairs.length} riskState=${JSON.stringify(data.riskState)}`,
      };
    } catch (e) {
      setSetting("strategy_enabled", "false");
      return { name: "Full strategy tick (end-to-end)", ok: false, detail: String(e) };
    }
  })());

  // ── Summary ──────────────────────────────────────────────────────────────────
  // Roll back ALL test data — nothing written by this test suite persists.
  db.exec("ROLLBACK TO SAVEPOINT test_suite");
  db.exec("RELEASE SAVEPOINT test_suite");

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return Response.json({ passed, failed, total: results.length, results });
}
