import { getStats, getPnlHistory } from "@/lib/db";

export async function GET() {
  return Response.json({ stats: getStats(), pnlHistory: getPnlHistory() });
}
