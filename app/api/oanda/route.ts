import { getOandaAccount, getOandaPositions, getOandaLatestPrices, getOandaLiveTrades } from "@/lib/db";

export async function GET() {
  try {
    const account     = getOandaAccount();
    const positions   = getOandaPositions();
    const prices      = getOandaLatestPrices();
    const liveTrades  = getOandaLiveTrades("OPEN");

    // Flat key→value map for easy dashboard consumption
    const accountMap = Object.fromEntries(account.map(({ key, value }) => [key, value]));

    return Response.json({ account: accountMap, positions, prices, liveTrades });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
