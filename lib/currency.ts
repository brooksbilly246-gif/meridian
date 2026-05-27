// AED is pegged to USD at a fixed rate set by the UAE Central Bank since 1997.
export const AED_RATE = 3.6725;

export function toAED(usd: number): number {
  return usd * AED_RATE;
}

/** Format a USD amount as AED for display. */
export function formatAED(usd: number, opts?: { sign?: boolean }): string {
  const aed = Math.abs(usd * AED_RATE);
  const formatted = aed.toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (opts?.sign) {
    const prefix = usd >= 0 ? "+AED " : "-AED ";
    return prefix + formatted;
  }
  const prefix = usd < 0 ? "-AED " : "AED ";
  return prefix + formatted;
}
