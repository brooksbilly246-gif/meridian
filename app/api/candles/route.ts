// Candle data: serves OANDA bars when the bridge is running, falls back to Yahoo Finance.
import { getOandaCandles, hasOandaCandles } from "@/lib/db";

const TF_MAP: Record<string, { interval: string; range: string }> = {
  "1m":  { interval: "1m",  range: "1d"  },
  "5m":  { interval: "5m",  range: "5d"  },
  "15m": { interval: "15m", range: "5d"  },
  "1h":  { interval: "60m", range: "30d" },
  "4h":  { interval: "1h",  range: "60d" },
  "1d":  { interval: "1d",  range: "1y"  },
};

export async function GET(req: Request) {
  const url  = new URL(req.url);
  const pair = (url.searchParams.get("pair") ?? "EURUSD").toUpperCase().replace("/", "");
  const tf   = url.searchParams.get("tf") ?? "1h";

  // Prefer OANDA data when the bridge has populated it for this pair/tf
  if (hasOandaCandles(pair, tf)) {
    const candles = getOandaCandles(pair, tf);
    return Response.json({ pair, tf, candles, source: "oanda" });
  }

  // Fall back to Yahoo Finance
  const cfg     = TF_MAP[tf] ?? TF_MAP["1h"];
  const symbol  = `${pair}=X`;
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${cfg.interval}&range=${cfg.range}&includePrePost=false`;

  try {
    const res  = await fetch(yahooUrl, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 60 } });
    const json = await res.json();

    const result = json?.chart?.result?.[0];
    if (!result) return Response.json({ error: "No data" }, { status: 404 });

    const timestamps: number[] = result.timestamp ?? [];
    const { open, high, low, close, volume } = result.indicators.quote[0];

    const candles = timestamps
      .map((t, i) => ({
        time:   t as number,
        open:   open[i]   as number,
        high:   high[i]   as number,
        low:    low[i]    as number,
        close:  close[i]  as number,
        volume: volume?.[i] as number | undefined,
      }))
      .filter((c) => c.open != null && c.close != null);

    return Response.json({ pair, tf, candles, source: "yahoo" });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
