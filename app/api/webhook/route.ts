import { NextRequest } from "next/server";
import { insertSignal, openTrade, getSetting } from "@/lib/db";
import { notifySetup } from "@/lib/notify";

// TradingView sends JSON alerts to this endpoint.
// Expected payload:
// { pair, direction, action, entry, sl, tp, timeframe, trigger_at, secret }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const secret = getSetting("webhook_secret");
  if (secret && body.secret !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pair = String(body.pair ?? "UNKNOWN").toUpperCase();
  const direction = String(body.direction ?? body.side ?? "LONG").toUpperCase();
  const action = String(body.action ?? "signal").toLowerCase();
  const entry = body.entry ? Number(body.entry) : undefined;
  const sl = body.sl ? Number(body.sl) : undefined;
  const tp = body.tp ? Number(body.tp) : undefined;
  const timeframe = body.timeframe ? String(body.timeframe) : undefined;
  const trigger_at = body.trigger_at ? Number(body.trigger_at) : undefined;

  if (action === "open" || action === "entry") {
    openTrade({
      pair,
      direction,
      entry_price: entry ?? 0,
      stop_loss: sl,
      take_profit: tp,
      signal_source: "TRADINGVIEW",
    });
  }

  const result = insertSignal({
    pair,
    direction,
    timeframe,
    entry_price: entry,
    stop_loss: sl,
    take_profit: tp,
    trigger_at,
    raw_payload: JSON.stringify(body),
  });

  // Immediately notify as a fresh signal
  notifySetup({ pair, direction, entry_price: entry, window: "15m" });

  return Response.json({ ok: true, signal_id: result.lastInsertRowid });
}

export async function GET() {
  return Response.json({ status: "Meridian webhook active" });
}
