import { runStrategyTick } from "@/lib/strategy";

export async function POST() {
  try {
    const result = await runStrategyTick();
    return Response.json(result);
  } catch (e) {
    console.error("[strategy/tick] POST error:", e);
    return Response.json({
      time: new Date().toISOString(),
      phase: "ERROR",
      pairs: [],
      riskState: { daily_pnl: 0, consecutive_losses: 0, circuit_broken: 0 },
      error: String(e),
    });
  }
}

export async function GET() {
  try {
    const result = await runStrategyTick();
    return Response.json(result);
  } catch (e) {
    console.error("[strategy/tick] GET error:", e);
    return Response.json({
      time: new Date().toISOString(),
      phase: "ERROR",
      pairs: [],
      riskState: { daily_pnl: 0, consecutive_losses: 0, circuit_broken: 0 },
      error: String(e),
    });
  }
}
