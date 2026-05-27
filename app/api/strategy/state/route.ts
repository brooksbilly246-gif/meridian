import { getAllSessions, getOrCreateRiskState, getStrategyLog, getSetting } from "@/lib/db";

export async function GET() {
  const today = new Date().toISOString().split("T")[0];
  const sessions  = getAllSessions(today);
  const riskState = getOrCreateRiskState(today);
  const log       = getStrategyLog(30);
  const enabled   = getSetting("strategy_enabled") === "true";
  const pairs     = (getSetting("strategy_pairs") || "EURUSD,GBPUSD").split(",").map((p) => p.trim());

  return Response.json({ today, enabled, pairs, sessions, riskState, log });
}
