import { getDb } from "@/lib/db";

// Returns signals + trades for a given pair so the chart can annotate them.
export async function GET(req: Request) {
  const url  = new URL(req.url);
  const pair = (url.searchParams.get("pair") ?? "EURUSD").toUpperCase().replace("/", "");

  const db = getDb();

  // Match both "EURUSD" and "EUR/USD" stored formats
  const signals = db
    .prepare(
      `SELECT id, pair, direction, entry_price, stop_loss, take_profit, created_at, executed
       FROM signals
       WHERE REPLACE(UPPER(pair), '/', '') = ?
       ORDER BY created_at DESC LIMIT 50`
    )
    .all(pair);

  const trades = db
    .prepare(
      `SELECT id, pair, direction, entry_price, stop_loss, take_profit,
              close_price, pnl, status, open_time, close_time
       FROM trades
       WHERE REPLACE(UPPER(pair), '/', '') = ?
       ORDER BY open_time DESC LIMIT 50`
    )
    .all(pair);

  return Response.json({ signals, trades });
}
