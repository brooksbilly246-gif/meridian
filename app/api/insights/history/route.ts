import { getSettingChanges } from "@/lib/db";

export async function GET() {
  return Response.json({ changes: getSettingChanges() });
}
