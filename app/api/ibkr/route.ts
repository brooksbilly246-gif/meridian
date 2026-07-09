// Redirected to /api/oanda — IBKR bridge has been replaced by OANDA bridge.
export async function GET() {
  return Response.redirect("/api/oanda", 301);
}
