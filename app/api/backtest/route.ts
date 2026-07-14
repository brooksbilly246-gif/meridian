import {
  fetchCandles, runPairBacktest, buildPortfolio,
  dateRangeToTimestamps, intervalForRange,
} from "@/lib/backtest-engine";
import { AED_RATE } from "@/lib/currency";

export type {
  BacktestParams, BtTrade, AdvancedStats, PairResult, PortfolioSummary,
} from "@/lib/backtest-engine";

export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let params: any;
  try { params = await req.json(); }
  catch { return Response.json({ error: "Invalid request body" }, { status: 400 }); }

  const { pairs, dateFrom, dateTo, startingBalanceAED } = params;
  if (!pairs?.length) return Response.json({ error: "Select at least one pair" }, { status: 400 });

  const startUsd    = startingBalanceAED / AED_RATE;
  const { p1, p2 } = dateRangeToTimestamps(dateFrom, dateTo);
  const interval    = intervalForRange(p1, p2);

  const candlesByPair = await Promise.all(pairs.map((p: string) => fetchCandles(p, p1, p2, interval)));

  const byPair = pairs.map((pair: string, i: number) => {
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

  const portfolio = buildPortfolio(byPair, startUsd);
  return Response.json({ byPair, portfolio, intervalUsed: interval, startingBalanceUsd: startUsd });
}
