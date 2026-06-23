import { applyInsightSuggestion } from "@/lib/db";
import { computeInsights } from "@/lib/insights";

export async function POST(req: Request) {
  const { category, label, key, value, reason } = await req.json();
  if (!category || !label || !key || value == null) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }
  const change = applyInsightSuggestion(category, label, key, String(value), reason ?? null);
  try { computeInsights(); } catch { /* ignore */ }
  return Response.json({ ok: true, change });
}
