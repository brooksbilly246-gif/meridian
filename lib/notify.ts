import { exec } from "child_process";
import { getSetting } from "./db";

export function sendIMessage(message: string) {
  const target = getSetting("imessage_target");
  if (!target) return;

  const safe = message.replace(/"/g, '\\"').replace(/'/g, "\\'");
  const script = `tell application "Messages" to send "${safe}" to buddy "${target}"`;
  exec(`osascript -e '${script}'`, (err) => {
    if (err) console.error("[notify] iMessage failed:", err.message);
  });
}

export function notifySetup(signal: {
  pair: string;
  direction: string;
  entry_price?: number;
  window: "15m" | "5m" | "1m";
}) {
  const emoji = signal.direction === "LONG" ? "📈" : "📉";
  const msg = `${emoji} Meridian ALERT\n${signal.pair} ${signal.direction} setup in ${signal.window}\nEntry: ${signal.entry_price ?? "TBD"}`;
  sendIMessage(msg);

  if (typeof Notification !== "undefined") {
    new Notification(`Meridian — ${signal.pair} ${signal.direction}`, {
      body: `Setup approaching in ${signal.window}`,
    });
  }
}
