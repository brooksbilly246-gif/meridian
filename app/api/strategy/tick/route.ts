import { runStrategyTick } from "@/lib/strategy";

export async function POST() {
  const result = await runStrategyTick();
  return Response.json(result);
}

export async function GET() {
  const result = await runStrategyTick();
  return Response.json(result);
}
