import { calcPnl, toPips, fromPips, pipSize, scaledLotSize, calcATR } from "@/lib/risk";
import { AED_RATE } from "@/lib/currency";

type Candle = { time: number; open: number; high: number; low: number; close: number };

export type BacktestParams = {
  pairs:              string[];
  dateFrom:           string;
  dateTo:             string;
  startingBalanceAED: number;
  asianStart:         number;
  asianEnd:           number;
  breakoutStart:      number;
  breakoutEnd:        number;
  cutoffHour:         number;
  bufferPips:         number;
  tpMultiplier:       number;
  minRangePips:       number;
  maxRangePips:       number;
  riskPct:            number;
  breakevenR:         number;
  atrPeriod?:         number;
  atrMultiplier?:     number;
};

export type BtTrade = {
  date: string; pair: string; direction: "LONG" | "SHORT";
  entry: number; sl: number; tp: number; closePrice: number;
  outcome: "TP" | "SL" | "CUTOFF"; pnl: number; pips: number;
  lotSize: number; rangePips: number;
};

export type AdvancedStats = {
  sharpeRatio:       number;
  sortinoRatio:      number;
  avgWin:            number;
  avgLoss:           number;
  avgWinPips:        number;
  avgLossPips:       number;
  largestWin:        number;
  largestLoss:       number;
  expectancy:        number;
  recoveryFactor:    number;
  returnPct:         number;
  maxConsecWins:     number;
  maxConsecLosses:   number;
  avgTradesPerWeek:  number;
  outcomeBreakdown:  Record<string, number>;
  monthlyPnl:        { month: string; pnl: number; trades: number }[];
};

export type PairResult = {
  pair:         string;
  totalTrades:  number;
  wins:         number;
  losses:       number;
  winRate:      number;
  netPnl:       number;
  totalPips:    number;
  maxDrawdown:  number;
  profitFactor: number;
  skippedDays:  number;
  finalBalance: number;
  trades:       BtTrade[];
  equityCurve:  { date: string; balance: number }[];
};

export type PortfolioSummary = {
  totalTrades:  number;
  wins:         number;
  losses:       number;
  winRate:      number;
  netPnl:       number;
  totalPips:    number;
  maxDrawdown:  number;
  profitFactor: number;
  skippedDays:  number;
  finalBalance: number;
  advanced:     AdvancedStats;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function candleHour(ts: number): number {
  const d = new Date(ts * 1000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

function candleDate(ts: number): string {
  return new Date(ts * 1000).toISOString().split("T")[0];
}

async function fetchCandles(pair: string, p1: number, p2: number, interval: string): Promise<Candle[]> {
  const symbol = `${pair.toUpperCase()}=X`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res  = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
      const json = await res.json();
      const r    = json?.chart?.result?.[0];
      if (!r) return [];
      const ts: number[] = r.timestamp ?? [];
      const { open, high, low, close } = r.indicators.quote[0];
      return ts
        .map((t, i) => ({ time: t, open: open[i], high: high[i], low: low[i], close: close[i] }))
        .filter((c) => c.open != null && c.close != null);
    } catch {
      if (attempt === 2) return [];
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  return [];
}

// ─── Pair Backtest ────────────────────────────────────────────────────────────

function runPairBacktest(
  pair:               string,
  candles:            Candle[],
  params:             BacktestParams,
  startingBalanceUsd: number
): PairResult {
  const {
    dateFrom, dateTo,
    asianStart, asianEnd, breakoutStart, breakoutEnd, cutoffHour,
    bufferPips, tpMultiplier, minRangePips, maxRangePips, riskPct, breakevenR,
    atrPeriod = 14, atrMultiplier = 0,
  } = params;

  const buffer = fromPips(bufferPips, pair);
  const ps     = pipSize(pair);

  const filtered = candles.filter((c) => {
    const d = candleDate(c.time);
    return d >= dateFrom && d <= dateTo;
  });

  const byDate: Record<string, Candle[]> = {};
  for (const c of filtered) {
    const d = candleDate(c.time);
    (byDate[d] ??= []).push(c);
  }

  const trades: BtTrade[] = [];
  let balance = startingBalanceUsd;
  const equityCurve: { date: string; balance: number }[] = [{ date: "Start", balance }];
  let skippedDays = 0;

  for (const date of Object.keys(byDate).sort()) {
    const dow = new Date(date + "T12:00:00Z").getUTCDay();
    if (dow === 0 || dow === 5 || dow === 6) continue;

    const day = byDate[date].sort((a, b) => a.time - b.time);
    if (!day.length) continue;

    const asianC = day.filter((c) => { const h = candleHour(c.time); return h >= asianStart && h < asianEnd; });
    if (!asianC.length) { skippedDays++; continue; }

    const rangeHigh = Math.max(...asianC.map((c) => c.high));
    const rangeLow  = Math.min(...asianC.map((c) => c.low));
    const rangePips = toPips(rangeHigh, rangeLow, pair);

    if (rangePips < minRangePips || rangePips > maxRangePips) { skippedDays++; continue; }

    const boC = day.filter((c) => { const h = candleHour(c.time); return h >= breakoutStart && h < breakoutEnd; });
    if (!boC.length) { skippedDays++; continue; }

    const bothBroken = boC.some((c) => c.close > rangeHigh + buffer) && boC.some((c) => c.close < rangeLow - buffer);
    if (bothBroken) { skippedDays++; continue; }

    // ATR-buffered SL: widen stop by max(fixed buffer, atrMultiplier × ATR)
    // Uses candles up to the breakout window to avoid lookahead bias
    const preBo     = filtered.filter((c) => c.time < boC[0].time).slice(-(atrPeriod + 1));
    const atr       = atrMultiplier > 0 ? calcATR(preBo, atrPeriod) : 0;
    const slBuffer  = Math.max(buffer, atr * atrMultiplier);

    let direction: "LONG" | "SHORT" | null = null;
    let entry = 0, sl = 0, tp = 0;

    for (const c of boC) {
      if (c.close > rangeHigh + buffer) {
        direction = "LONG"; entry = rangeHigh + buffer; sl = rangeLow - slBuffer; tp = entry + (rangeHigh - rangeLow) * tpMultiplier; break;
      } else if (c.close < rangeLow - buffer) {
        direction = "SHORT"; entry = rangeLow - buffer; sl = rangeHigh + slBuffer; tp = entry - (rangeHigh - rangeLow) * tpMultiplier; break;
      }
    }

    if (!direction) { skippedDays++; continue; }

    const lot    = scaledLotSize(balance, startingBalanceUsd, riskPct, entry, sl, pair);
    const isLong = direction === "LONG";
    const mgmt   = day.filter((c) => candleHour(c.time) >= breakoutStart);
    let outcome: "TP" | "SL" | "CUTOFF" = "CUTOFF";
    let closePrice = mgmt.at(-1)?.close ?? entry;
    let currentSl  = sl;

    for (const c of mgmt) {
      const slHit = isLong ? c.low <= currentSl : c.high >= currentSl;
      const tpHit = isLong ? c.high >= tp : c.low <= tp;
      if (slHit && !tpHit) { outcome = "SL"; closePrice = currentSl; break; }
      if (tpHit) { outcome = "TP"; closePrice = tp; break; }
      if (candleHour(c.time) >= cutoffHour) { outcome = "CUTOFF"; closePrice = c.close; break; }
      const inPips   = isLong ? (c.close - entry) / ps : (entry - c.close) / ps;
      const riskPipsVal = toPips(entry, currentSl, pair) * breakevenR;
      if (inPips >= riskPipsVal && Math.abs(currentSl - entry) > ps * 2) currentSl = entry;
    }

    const { pnl, pips } = calcPnl(direction, entry, closePrice, lot, pair);
    balance += pnl;
    trades.push({ date, pair, direction, entry, sl, tp, closePrice, outcome, pnl, pips, lotSize: lot, rangePips });
    equityCurve.push({ date, balance: parseFloat(balance.toFixed(2)) });
  }

  const wins      = trades.filter((t) => t.pnl > 0);
  const losses    = trades.filter((t) => t.pnl <= 0);
  const grossWin  = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  let peak = startingBalanceUsd, maxDd = 0, runBal = startingBalanceUsd;
  for (const t of trades) {
    runBal += t.pnl;
    if (runBal > peak) peak = runBal;
    const dd = ((peak - runBal) / peak) * 100;
    if (dd > maxDd) maxDd = dd;
  }

  return {
    pair,
    totalTrades:  trades.length,
    wins:         wins.length,
    losses:       losses.length,
    winRate:      trades.length > 0 ? parseFloat(((wins.length / trades.length) * 100).toFixed(1)) : 0,
    netPnl:       parseFloat((balance - startingBalanceUsd).toFixed(2)),
    totalPips:    parseFloat(trades.reduce((s, t) => s + t.pips, 0).toFixed(1)),
    maxDrawdown:  parseFloat(maxDd.toFixed(2)),
    profitFactor: grossLoss > 0 ? parseFloat((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 999 : 0,
    skippedDays,
    finalBalance: parseFloat(balance.toFixed(2)),
    trades,
    equityCurve,
  };
}

// ─── Advanced Stats ──────────────────────────────────────────────────────────

function computeAdvancedStats(
  trades: BtTrade[],
  startUsd: number,
  maxDrawdownPct: number,
): AdvancedStats {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const avgWin     = wins.length   ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length     : 0;
  const avgLoss    = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length  : 0;
  const avgWinPips  = wins.length   ? wins.reduce((s, t) => s + t.pips, 0) / wins.length    : 0;
  const avgLossPips = losses.length ? losses.reduce((s, t) => s + t.pips, 0) / losses.length : 0;
  const largestWin  = wins.length   ? Math.max(...wins.map((t) => t.pnl))   : 0;
  const largestLoss = losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0;

  const winRate    = trades.length ? wins.length / trades.length : 0;
  const expectancy = trades.length ? (winRate * avgWin + (1 - winRate) * avgLoss) : 0;

  const netPnl        = trades.reduce((s, t) => s + t.pnl, 0);
  const returnPct     = startUsd > 0 ? (netPnl / startUsd) * 100 : 0;
  const recoveryFactor = maxDrawdownPct > 0 ? returnPct / maxDrawdownPct : 0;

  const dailyPnl: Record<string, number> = {};
  for (const t of trades) dailyPnl[t.date] = (dailyPnl[t.date] ?? 0) + t.pnl;
  const dailyReturns = Object.values(dailyPnl);
  const meanReturn   = dailyReturns.length ? dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length : 0;
  const variance     = dailyReturns.length > 1
    ? dailyReturns.reduce((s, v) => s + (v - meanReturn) ** 2, 0) / (dailyReturns.length - 1)
    : 0;
  const stdDev       = Math.sqrt(variance);
  const sharpeRatio  = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

  const downside     = dailyReturns.filter((r) => r < 0);
  const downVar      = downside.length > 1
    ? downside.reduce((s, v) => s + v ** 2, 0) / (downside.length - 1)
    : 0;
  const downDev      = Math.sqrt(downVar);
  const sortinoRatio = downDev > 0 ? (meanReturn / downDev) * Math.sqrt(252) : 0;

  let maxConsecWins = 0, maxConsecLosses = 0, cw = 0, cl = 0;
  for (const t of trades) {
    if (t.pnl > 0) { cw++; cl = 0; if (cw > maxConsecWins) maxConsecWins = cw; }
    else           { cl++; cw = 0; if (cl > maxConsecLosses) maxConsecLosses = cl; }
  }

  const dates = [...new Set(trades.map((t) => t.date))].sort();
  const tradingDays = dates.length;
  const avgTradesPerWeek = tradingDays > 0 ? (trades.length / tradingDays) * 5 : 0;

  const outcomeBreakdown: Record<string, number> = {};
  for (const t of trades) outcomeBreakdown[t.outcome] = (outcomeBreakdown[t.outcome] ?? 0) + 1;

  const monthMap: Record<string, { pnl: number; trades: number }> = {};
  for (const t of trades) {
    const month = t.date.slice(0, 7);
    if (!monthMap[month]) monthMap[month] = { pnl: 0, trades: 0 };
    monthMap[month].pnl += t.pnl;
    monthMap[month].trades++;
  }
  const monthlyPnl = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({ month, pnl: parseFloat(d.pnl.toFixed(2)), trades: d.trades }));

  return {
    sharpeRatio:  parseFloat(sharpeRatio.toFixed(2)),
    sortinoRatio: parseFloat(sortinoRatio.toFixed(2)),
    avgWin:       parseFloat(avgWin.toFixed(2)),
    avgLoss:      parseFloat(avgLoss.toFixed(2)),
    avgWinPips:   parseFloat(avgWinPips.toFixed(1)),
    avgLossPips:  parseFloat(avgLossPips.toFixed(1)),
    largestWin:   parseFloat(largestWin.toFixed(2)),
    largestLoss:  parseFloat(largestLoss.toFixed(2)),
    expectancy:   parseFloat(expectancy.toFixed(2)),
    recoveryFactor: parseFloat(recoveryFactor.toFixed(2)),
    returnPct:    parseFloat(returnPct.toFixed(2)),
    maxConsecWins,
    maxConsecLosses,
    avgTradesPerWeek: parseFloat(avgTradesPerWeek.toFixed(1)),
    outcomeBreakdown,
    monthlyPnl,
  };
}

// ─── API Handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let params: BacktestParams;
  try { params = await req.json(); }
  catch { return Response.json({ error: "Invalid request body" }, { status: 400 }); }

  const { pairs, dateFrom, dateTo, startingBalanceAED } = params;
  if (!pairs?.length) return Response.json({ error: "Select at least one pair" }, { status: 400 });

  const startUsd = startingBalanceAED / AED_RATE;
  const p1       = Math.floor(new Date(dateFrom + "T00:00:00Z").getTime() / 1000);
  const p2       = Math.floor(new Date(dateTo   + "T23:59:59Z").getTime() / 1000);
  const daysDiff = (p2 - p1) / 86400;
  const interval = daysDiff <= 58 ? "15m" : "1h";

  const candlesByPair = await Promise.all(pairs.map((p) => fetchCandles(p, p1, p2, interval)));

  const byPair: PairResult[] = pairs.map((pair, i) => {
    if (!candlesByPair[i].length) {
      return {
        pair, totalTrades: 0, wins: 0, losses: 0, winRate: 0,
        netPnl: 0, totalPips: 0, maxDrawdown: 0, profitFactor: 0,
        skippedDays: 0, finalBalance: startUsd, trades: [],
        equityCurve: [{ date: "Start", balance: startUsd }],
      };
    }
    return runPairBacktest(pair, candlesByPair[i], params, startUsd);
  });

  const dailyPnl: Record<string, number> = {};
  for (const pr of byPair)
    for (const t of pr.trades)
      dailyPnl[t.date] = (dailyPnl[t.date] ?? 0) + t.pnl;

  let portBal = startUsd;
  const portfolioEquity: { date: string; balance: number }[] = [{ date: "Start", balance: portBal }];
  let portPeak = portBal, portMaxDd = 0;

  for (const date of Object.keys(dailyPnl).sort()) {
    portBal += dailyPnl[date];
    if (portBal > portPeak) portPeak = portBal;
    const dd = ((portPeak - portBal) / portPeak) * 100;
    if (dd > portMaxDd) portMaxDd = dd;
    portfolioEquity.push({ date, balance: parseFloat(portBal.toFixed(2)) });
  }

  const allTrades  = byPair.flatMap((r) => r.trades).sort((a, b) => a.date.localeCompare(b.date));
  const portWins   = allTrades.filter((t) => t.pnl > 0);
  const portLosses = allTrades.filter((t) => t.pnl <= 0);
  const portGW     = portWins.reduce((s, t) => s + t.pnl, 0);
  const portGL     = Math.abs(portLosses.reduce((s, t) => s + t.pnl, 0));

  const advanced = computeAdvancedStats(allTrades, startUsd, portMaxDd);

  const portfolio = {
    summary: {
      totalTrades:  allTrades.length,
      wins:         portWins.length,
      losses:       portLosses.length,
      winRate:      allTrades.length > 0 ? parseFloat(((portWins.length / allTrades.length) * 100).toFixed(1)) : 0,
      netPnl:       parseFloat((portBal - startUsd).toFixed(2)),
      totalPips:    parseFloat(allTrades.reduce((s, t) => s + t.pips, 0).toFixed(1)),
      maxDrawdown:  parseFloat(portMaxDd.toFixed(2)),
      profitFactor: portGL > 0 ? parseFloat((portGW / portGL).toFixed(2)) : portGW > 0 ? 999 : 0,
      skippedDays:  byPair.reduce((s, r) => s + r.skippedDays, 0),
      finalBalance: parseFloat(portBal.toFixed(2)),
      advanced,
    },
    equityCurve:  portfolioEquity,
    allTrades,
  };

  return Response.json({ byPair, portfolio, intervalUsed: interval, startingBalanceUsd: startUsd });
}
