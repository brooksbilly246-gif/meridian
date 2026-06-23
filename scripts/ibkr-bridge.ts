/**
 * IBKR Bridge — read-only data sync from IB Gateway → kairos.db
 *
 * Reads: account summary, positions, execution fills, historical + live bars.
 * Writes: ibkr_account, ibkr_positions, ibkr_candles, strategy_log tables.
 *
 * Run as a standalone process (NOT inside Next.js):
 *   npm run ibkr-bridge
 *
 * WARNING — port reference:
 *   4001 = TWS live account
 *   4002 = TWS paper account  ← default here
 *   7496 = IB Gateway live
 *   7497 = IB Gateway paper
 */

// Load .env.local before reading any env vars (tsx doesn't auto-load it)
import { existsSync, readFileSync } from "fs";
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

import {
  IBApi, EventName, BarSizeSetting, WhatToShow, SecType,
} from "@stoqey/ib";
import type { Contract } from "@stoqey/ib";
import Database from "better-sqlite3";
import path from "path";

// ─── Config (all overridable via env) ─────────────────────────────────────────
const HOST      = process.env.IBKR_HOST      ?? "127.0.0.1";
const PORT      = parseInt(process.env.IBKR_PORT      ?? "4002", 10);
const CLIENT_ID = parseInt(process.env.IBKR_CLIENT_ID ?? "1",    10);
const SYMBOLS   = (process.env.IBKR_SYMBOLS ?? "EURUSD,GBPUSD")
  .split(",").map((s) => s.trim().toUpperCase());

// Timeframes to fetch for each symbol
const TF_CONFIGS: Array<{ appTf: string; barSize: BarSizeSetting; duration: string }> = [
  { appTf: "15m", barSize: BarSizeSetting.MINUTES_FIFTEEN, duration: "5 D"  },
  { appTf: "1h",  barSize: BarSizeSetting.HOURS_ONE,       duration: "30 D" },
];

// Account summary tags to pull
const ACCT_TAGS = "NetLiquidation,TotalCashValue,BuyingPower,UnrealizedPnL,RealizedPnL,AvailableFunds";

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(msg: string) {
  console.log(`[ibkr-bridge] ${new Date().toISOString()}  ${msg}`);
}

// ─── DB (opened once; tables created idempotently) ───────────────────────────
const DB_PATH = path.join(process.cwd(), "meridian.db");
let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ibkr_candles (
        pair TEXT NOT NULL, tf TEXT NOT NULL, time INTEGER NOT NULL,
        open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL,
        close REAL NOT NULL, volume REAL,
        PRIMARY KEY (pair, tf, time)
      );
      CREATE TABLE IF NOT EXISTS ibkr_account (
        key TEXT PRIMARY KEY, value TEXT, currency TEXT,
        updated_at INTEGER DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS ibkr_positions (
        symbol TEXT PRIMARY KEY, pair TEXT, sec_type TEXT,
        position REAL NOT NULL, avg_cost REAL, currency TEXT,
        updated_at INTEGER DEFAULT (unixepoch())
      );
    `);
  }
  return _db;
}

function upsertCandle(
  pair: string, tf: string, time: number,
  open: number, high: number, low: number, close: number, volume: number,
) {
  getDb().prepare(
    `INSERT OR REPLACE INTO ibkr_candles (pair, tf, time, open, high, low, close, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(pair, tf, time, open, high, low, close, volume);
}

function upsertAccount(key: string, value: string, currency: string) {
  getDb().prepare(
    `INSERT OR REPLACE INTO ibkr_account (key, value, currency, updated_at)
     VALUES (?, ?, ?, unixepoch())`,
  ).run(key, value, currency);
}

function upsertPosition(
  symbol: string, pair: string | null, secType: string,
  position: number, avgCost: number, currency: string,
) {
  getDb().prepare(
    `INSERT OR REPLACE INTO ibkr_positions
       (symbol, pair, sec_type, position, avg_cost, currency, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
  ).run(symbol, pair, secType, position, avgCost, currency);
}

function dbLog(level: string, message: string, pair?: string) {
  try {
    getDb().prepare(
      "INSERT INTO strategy_log (level, message, pair) VALUES (?, ?, ?)",
    ).run(level, message, pair ?? null);
  } catch { /* strategy_log table may not exist yet — non-fatal */ }
}

// ─── Symbol → IBKR contract ───────────────────────────────────────────────────
// EURUSD → symbol "EUR", currency "USD", exchange IDEALPRO
function pairToContract(pair: string): Contract {
  return {
    symbol:   pair.slice(0, 3),
    secType:  SecType.CASH,
    currency: pair.slice(3),
    exchange: "IDEALPRO",
  };
}

// ─── Connection state ─────────────────────────────────────────────────────────
let ib: IBApi | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 2_000;        // starts at 2 s, doubles on each failure
const MAX_RECONNECT_DELAY = 60_000; // cap at 60 s

let reqCounter = 100;
function nextReqId(): number { return ++reqCounter; }

// reqId → { pair, tf } so historicalData events can be correlated
const reqMap = new Map<number, { pair: string; tf: string }>();

// ─── Reconnect logic ──────────────────────────────────────────────────────────
function scheduleReconnect() {
  if (reconnectTimer) return; // already pending
  log(`Reconnecting in ${reconnectDelay / 1000}s…`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

// ─── Subscribe after connection ───────────────────────────────────────────────
function onConnected(api: IBApi) {
  reconnectDelay = 2_000; // reset backoff on successful connect
  reqMap.clear();

  // 1. Account summary
  api.reqAccountSummary(nextReqId(), "All", ACCT_TAGS);

  // 2. Positions
  api.reqPositions();

  // 3. Historical + live bars for each symbol × timeframe
  //    Small delay between requests to respect IB's 50-req/s pacing limit
  let delay = 0;
  for (const pair of SYMBOLS) {
    const contract = pairToContract(pair);
    for (const tf of TF_CONFIGS) {
      const id = nextReqId();
      reqMap.set(id, { pair, tf: tf.appTf });
      setTimeout(() => {
        log(`Requesting ${pair}/${tf.appTf} history (reqId=${id})`);
        api.reqHistoricalData(
          id,
          contract,
          "",            // endDateTime = now (required when keepUpToDate=true)
          tf.duration,   // "5 D" or "30 D"
          tf.barSize,    // BarSizeSetting enum
          WhatToShow.MIDPOINT,
          0,             // useRTH=0 → include all hours (forex trades 24h)
          2,             // formatDate=2 → unix epoch timestamps
          true,          // keepUpToDate=true → live bar updates via historicalDataUpdate
        );
      }, delay);
      delay += 200; // 200 ms between each reqHistoricalData call
    }
  }

  // 4. Recent executions/fills (last 24 h)
  api.reqExecutions(nextReqId(), {});

  dbLog("INFO", `[IBKR] Bridge connected — syncing ${SYMBOLS.join(", ")}`);
  log(`Subscriptions started for: ${SYMBOLS.join(", ")}`);
}

// ─── Connect ──────────────────────────────────────────────────────────────────
function connect() {
  // Tear down any stale instance first
  if (ib) {
    try { ib.disconnect(); } catch { /* ignore */ }
    ib = null;
  }

  log(`Connecting to IB Gateway at ${HOST}:${PORT} (clientId=${CLIENT_ID})…`);

  ib = new IBApi({ host: HOST, port: PORT });

  // ── Connection lifecycle ────────────────────────────────────────────────────
  ib.on(EventName.connected, () => {
    log("Connected to IB Gateway ✓");
    onConnected(ib!);
  });

  ib.on(EventName.disconnected, () => {
    log("Disconnected from IB Gateway");
    scheduleReconnect();
  });

  ib.on(EventName.error, (err: Error, code: number, reqId: number) => {
    const msg = `code=${code} reqId=${reqId}: ${err?.message ?? String(err)}`;
    // Codes 2100–2199 are informational connectivity notices, not real errors
    if (code >= 2100 && code < 2200) {
      log(`[INFO] ${msg}`);
    } else if (code === 200) {
      // "No security definition" — the symbol/contract combo isn't supported
      const meta = reqMap.get(reqId);
      log(`[WARN] No data for ${meta ? `${meta.pair}/${meta.tf}` : `reqId=${reqId}`} (${msg})`);
    } else {
      log(`[ERROR] ${msg}`);
    }
  });

  // ── Account summary ─────────────────────────────────────────────────────────
  ib.on(EventName.accountSummary, (_reqId, _account, tag, value, currency) => {
    upsertAccount(tag, value, currency);
  });

  ib.on(EventName.accountSummaryEnd, () => {
    log("Account summary loaded");
  });

  // ── Positions ───────────────────────────────────────────────────────────────
  ib.on(EventName.position, (_account, contract, pos, avgCost) => {
    const sym      = contract.symbol  ?? "UNKNOWN";
    const secType  = (contract.secType ?? "UNKNOWN") as string;
    const currency = contract.currency ?? "";
    // Reconstruct a "pair" string for CASH (forex) contracts only
    const pair = secType === SecType.CASH ? `${sym}${currency}` : null;
    upsertPosition(sym, pair, secType, pos, avgCost ?? 0, currency);
    log(`Position: ${sym}/${currency}  pos=${pos}  avgCost=${avgCost ?? "n/a"}`);
  });

  ib.on(EventName.positionEnd, () => {
    log("Positions synced");
    dbLog("INFO", "[IBKR] Positions synced");
  });

  // ── Historical bars (initial load) ──────────────────────────────────────────
  ib.on(EventName.historicalData, (reqId, time, open, high, low, close, volume) => {
    const meta = reqMap.get(reqId);
    if (!meta) return;
    const ts = parseInt(time, 10);
    if (!isNaN(ts) && open != null && close != null) {
      upsertCandle(meta.pair, meta.tf, ts, open, high, low, close, volume ?? 0);
    }
  });

  ib.on(EventName.historicalDataEnd, (reqId) => {
    const meta = reqMap.get(reqId);
    if (meta) {
      log(`Historical load complete: ${meta.pair}/${meta.tf} — live bar updates active`);
      dbLog("INFO", `[IBKR] ${meta.pair}/${meta.tf} historical load done`);
    }
  });

  // ── Live bar updates (fires as each bar closes when keepUpToDate=true) ───────
  ib.on(EventName.historicalDataUpdate, (reqId, time, open, high, low, close, volume) => {
    const meta = reqMap.get(reqId);
    if (!meta) return;
    const ts = parseInt(time, 10);
    if (!isNaN(ts) && open != null && close != null) {
      upsertCandle(meta.pair, meta.tf, ts, open, high, low, close, volume ?? 0);
      log(`Bar update: ${meta.pair}/${meta.tf}  t=${ts}  close=${close}`);
    }
  });

  // ── Execution fills ─────────────────────────────────────────────────────────
  ib.on(EventName.execDetails, (_reqId, contract, execution) => {
    const sym = contract.symbol ?? "UNKNOWN";
    const msg = [
      `[IBKR] Fill: ${sym}`,
      `side=${execution.side}`,
      `qty=${execution.shares}`,
      `price=${execution.price}`,
      `time=${execution.time}`,
      `acct=${execution.acctNumber}`,
    ].join("  ");
    log(msg);
    dbLog("INFO", msg, sym);
  });

  // Initiate the TCP connection
  ib.connect(CLIENT_ID);
}

// ─── Start ────────────────────────────────────────────────────────────────────
log(`Starting IBKR bridge`);
log(`  Host:     ${HOST}:${PORT}`);
log(`  ClientId: ${CLIENT_ID}`);
log(`  Symbols:  ${SYMBOLS.join(", ")}`);

// Ensure DB tables exist before the first connect
getDb();

connect();

// Keep the event loop alive (IBApi uses internal sockets, but this is belt-and-suspenders)
process.stdin.resume();

// Clean shutdown on Ctrl-C
process.on("SIGINT", () => {
  log("Shutting down (SIGINT)…");
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ib) try { ib.disconnect(); } catch { /* ignore */ }
  process.exit(0);
});
