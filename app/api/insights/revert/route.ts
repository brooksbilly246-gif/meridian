import { revertSettingChange } from "@/lib/db";
import { computeInsights } from "@/lib/insights";

export async function POST(req: Request) {
  const { id } = await req.json();
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  const ok = revertSettingChange(id);
  if (!ok) return Response.json({ error: "Change not found or already reverted" }, { status: 404 });
  try { computeInsights(); } catch { /* ignore */ }
  return Response.json({ ok: true });
}
