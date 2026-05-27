import { getDb } from "@/lib/db";

// Hard reset: wipes all trades, signals, sessions, risk state and strategy log.
// Paper balance is kept from settings (or reset to default if provided).
export async function POST() {
  const db = getDb();
  db.exec(`
    DELETE FROM trades;
    DELETE FROM signals;
    DELETE FROM strategy_sessions;
    DELETE FROM risk_state;
    DELETE FROM strategy_log;
    DELETE FROM sqlite_sequence WHERE name IN ('trades','signals','strategy_sessions','risk_state','strategy_log');
  `);
  return Response.json({ ok: true, message: "Paper account reset. All trades and signals cleared." });
}
