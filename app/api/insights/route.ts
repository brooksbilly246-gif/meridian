import { getInsights, setSetting } from "@/lib/db";
import { computeInsights } from "@/lib/insights";

export async function GET() {
  // Recompute on demand so the page always reflects the latest trades
  try { computeInsights(); } catch { /* ignore if no data */ }
  return Response.json({ insights: getInsights() });
}

export async function POST(req: Request) {
  const { key, value } = await req.json();
  if (!key || value == null) {
    return Response.json({ error: "Missing key or value" }, { status: 400 });
  }
  setSetting(key, String(value));
  try { computeInsights(); } catch { /* ignore */ }
  return Response.json({ ok: true });
}
