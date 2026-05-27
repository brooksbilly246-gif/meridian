import { getAllTrades, getOpenTrades, getPendingSignals } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "all";

  if (type === "open") return Response.json(getOpenTrades());
  if (type === "signals") return Response.json(getPendingSignals());
  return Response.json(getAllTrades(200));
}
