import { getAllSettings, setSetting } from "@/lib/db";

export async function GET() {
  return Response.json(getAllSettings());
}

export async function POST(req: Request) {
  const body = await req.json();
  for (const [k, v] of Object.entries(body)) {
    setSetting(k, String(v));
  }
  return Response.json({ ok: true });
}
