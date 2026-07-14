import { getIbkrAccount, getIbkrPositions } from "@/lib/db";

export async function GET() {
  try {
    const account   = getIbkrAccount();
    const positions = getIbkrPositions();

    // Build a flat key→value map for easy consumption by the dashboard
    const accountMap = Object.fromEntries(
      account.map(({ key, value, currency }) => [key, { value, currency }])
    );

    return Response.json({ account: accountMap, positions });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
