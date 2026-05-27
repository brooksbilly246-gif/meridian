import { calcPnl, toPips, fromPips, pipSize, scaledLotSize } from "@/lib/risk";
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
};

export type BtTrade = {
  date: string; pair: string; direction: "LONG" | "SHORT";
  entry: number; sl: number; tp: number; closePrice: number;
  outcome: "TP" | "SL" | "CUTOFF"; pnl: number; pips: number;
  lotSize: number; rangePips: number;
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
};

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
      const ts: number[]                     = r.timestamp ?? [];
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

function runPairBacktest(
  pair:             string,
  candles:          Candle[],
  params:           BacktestParams,
  startingBalanceUsd: number
): PairResult {
  const {
    dateFrom, dateTo,
    asianStart, asianEnd, breakoutStart, breakoutEnd, cutoffHour,
    bufferPips, tpMultiplier, minRangePips, maxRangePips, riskPct, breakevenR,
  } = params;

  const buffer = fromPips(bufferPips, pair);
  const ps     = pipSize(pair);

  // Filter to requested date range
  const filtered = candles.filter((c) => {
    const d = candleDate(c.time);
    return d >= dateFrom && d <= dateTo;
  });

  // Group by date
  const byDate: Record<string, Candle[]> = {};
  for (const c of filtered) {
    const d = candleDate(c.time);
    (byDate[d] ??= []).push(c);
  }

  const trades: BtTrade[]                        = [];
  let balance                                     = startingBalanceUsd;
  const equityCurve: { date: string; balance: number }[] = [{ date: "Start", balance }];
  let skippedDays                                 = 0;

  for (const date of Object.keys(byDate).sort()) {
    const dow = new Date(date + "T12:00:00Z").getUTCDay();
    if (dow === 0 || dow === 5 || dow === 6) continue;

    const day = byDate[date].sort((a, b) => a.time - b.time);

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

    let direction: "LONG" | "SHORT" | null = null;
    let entry = 0, sl = 0, tp = 0;

    for (const c of boC) {
      if (c.close > rangeHigh + buffer) {
        direction = "LONG";  entry = rangeHigh + buffer; sl = rangeLow  - buffer; tp = entry + (rangeHigh - rangeLow) * tpMultiplier; break;
      } else if (c.close < rangeLow - buffer) {
        direction = "SHORT"; entry = rangeLow  - buffer; sl = rangeHigh + buffer; tp = entry - (rangeHigh - rangeLow) * tpMultiplier; break;
      }
    }
    if (!direction) { skippedDays++; continue; }

    const lot    = scaledLotSize(balance, startingBalanceUsd, riskPct, entry, sl, pair);
    const isLong = direction === "LONG";

    const mgmt      = day.filter((c) => candleHour(c.time) >= breakoutStart);
    let outcome: "TP" | "SL" | "CUTOFF" = "CUTOFF";
    let closePrice  = mgmt.at(-1)?.close ?? entry;
    let currentSl   = sl;

    for (const c of mgmt) {
      const slHit = isLong ? c.low  <= currentSl : c.high >= currentSl;
      const tpHit = isLong ? c.high >= tp        : c.low  <= tp;
      if (slHit && !tpHit) { outcome = "SL"; closePrice = currentSl; break; }
      if (tpHit)            { outcome = "TP"; closePrice = tp; break; }
      if (candleHour(c.time) >= cutoffHour) { outcome = "CUTOFF"; closePrice = c.close; break; }
      // Breakeven
      const inPips   = isLong ? (c.close - entry) / ps : (entry - c.close) / ps;
      const riskPips = toPips(entry, currentSl, pair) * breakevenR;
      if (inPips >= riskPips && Math.abs(currentSl - entry) > ps * 2) currentSl = entry;
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

  // Fetch all pairs in parallel
  const candlesByPair = await Promise.all(pairs.map((p) => fetchCandles(p, p1, p2, interval)));

  // Run each pair
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

  // Portfolio: combine all P&L streams chronologically
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

  const portfolio: { summary: PortfolioSummary; equityCurve: typeof portfolioEquity; allTrades: BtTrade[] } = {
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
    },
    equityCurve:  portfolioEquity,
    allTrades,
  };

  return Response.json({ byPair, portfolio, intervalUsed: interval, startingBalanceUsd: startUsd });
}
