/**
 * OANDA Bridge — London Session Breakout live trading via OANDA v20 REST API
 *
 * Configure in .env.local:
 *   OANDA_API_KEY=your-personal-access-token
 *   OANDA_ACCOUNT_ID=001-004-xxxxxxx-001
 *   OANDA_ENV=practice        # or "live" when ready
 *   OANDA_DRY_RUN=true        # set to "false" to place real orders
 *
 * Run: npm run oanda-bridge
 *
 * Tick loop runs every 60 s, mirroring LSB strategy phases:
 *   02:00–07:00 UTC  Asian range build
 *   08:00–10:00 UTC  Breakout detection + order placement
 *   10:00–12:00 UTC  Breakeven management
 *   12:00 UTC        Force-close cutoff
 */

import { existsSync, readFileSync } from "fs";
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

import {
  getDb,
  getSetting,
  stratLog,
  getOrCreateSession,
  updateSession,
  getOrCreateRiskState,
  updateRiskState,
} from "../lib/db";
import {
  toPips, fromPips, pipSize, calcATR, calcLotSize,
} from "../lib/risk";

// ─── Config ───────────────────────────────────────────────────────────────────

const API_KEY    = process.env.OANDA_API_KEY    ?? "";
const ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID ?? "";
const OANDA_ENV  = (process.env.OANDA_ENV ?? "practice") as "practice" | "live";
const DRY_RUN    = process.env.OANDA_DRY_RUN !== "false"; // safe default: true

if (!API_KEY || !ACCOUNT_ID) {
  console.error("[oanda-bridge] OANDA_API_KEY and OANDA_ACCOUNT_ID must be set in .env.local");
  process.exit(1);
}

const BASE = OANDA_ENV === "live"
  ? "https://api-fxtrade.oanda.com"
  : "https://api-fxpractice.oanda.com";

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[oanda-bridge] ${new Date().toISOString()}  ${msg}`);
}

// ─── DB bootstrap (OANDA-specific tables) ────────────────────────────────────

function initOandaTables() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS oanda_candles (
      pair TEXT NOT NULL, tf TEXT NOT NULL, time INTEGER NOT NULL,
      open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL,
      close REAL NOT NULL, volume REAL,
      PRIMARY KEY (pair, tf, time)
    );
    CREATE TABLE IF NOT EXISTS oanda_account (
      key TEXT PRIMARY KEY, value TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS oanda_positions (
      trade_id TEXT PRIMARY KEY,
      instrument TEXT NOT NULL, pair TEXT,
      units REAL NOT NULL, price REAL,
      stop_loss REAL, take_profit REAL,
      unrealized_pnl REAL,
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS oanda_live_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair TEXT NOT NULL, direction TEXT NOT NULL,
      oanda_trade_id TEXT UNIQUE,
      entry_price REAL, stop_loss REAL, take_profit REAL,
      lot_size REAL, units INTEGER,
      session_date TEXT,
      status TEXT DEFAULT 'OPEN',
      breakeven_moved INTEGER DEFAULT 0,
      pnl REAL, close_price REAL, close_time INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);
}

// ─── Instrument format ────────────────────────────────────────────────────────

function toInstrument(pair: string): string  { return `${pair.slice(0, 3)}_${pair.slice(3)}`; }
function fromInstrument(inst: string): string { return inst.replace("_", ""); }

function lotsToUnits(lots: number, direction: "LONG" | "SHORT"): number {
  const units = Math.round(lots * 100_000);
  return direction === "LONG" ? units : -units;
}

// ─── OANDA HTTP ───────────────────────────────────────────────────────────────

async function oandaFetch(url: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type RawCandle = { time: string; mid: { o: string; h: string; l: string; c: string }; volume: number; complete: boolean };
type Candle    = { time: number; open: number; high: number; low: number; close: number; complete: boolean };

type OandaTrade = {
  id: string; instrument: string; price: string;
  currentUnits: string; unrealizedPL: string; realizedPL: string;
  state: string; openTime?: string; closeTime?: string;
  averageClosePrice?: string;
  stopLossOrder?:   { price: string };
  takeProfitOrder?: { price: string };
};

type LiveTrade = {
  id: number; pair: string; direction: string; oanda_trade_id: string | null;
  entry_price: number; stop_loss: number; take_profit: number;
  lot_size: number; units: number; session_date: string;
  status: string; breakeven_moved: number;
  pnl: number | null; close_price: number | null; close_time: number | null;
};

// ─── OANDA: fetch candles ─────────────────────────────────────────────────────

async function fetchOandaCandles(instrument: string, granularity: string, count: number): Promise<Candle[]> {
  const url = `${BASE}/v3/instruments/${instrument}/candles?price=M&granularity=${granularity}&count=${count}`;
  try {
    const res = await oandaFetch(url);
    if (!res.ok) { log(`[WARN] Candle ${instrument} ${granularity}: HTTP ${res.status}`); return []; }
    const data = await res.json() as { candles?: RawCandle[] };
    return (data.candles ?? []).map(c => ({
      time:     Math.floor(new Date(c.time).getTime() / 1000),
      open:     parseFloat(c.mid.o),
      high:     parseFloat(c.mid.h),
      low:      parseFloat(c.mid.l),
      close:    parseFloat(c.mid.c),
      complete: c.complete,
    }));
  } catch (e) {
    log(`[WARN] Candle fetch error: ${e}`);
    return [];
  }
}

// ─── OANDA: account & positions ───────────────────────────────────────────────

async function syncAccount(): Promise<number> {
  try {
    const res = await oandaFetch(`${BASE}/v3/accounts/${ACCOUNT_ID}/summary`);
    if (!res.ok) return 0;
    const data = await res.json() as { account?: Record<string, unknown> };
    const acct = data.account ?? {};
    const db   = getDb();
    const ups  = db.prepare("INSERT OR REPLACE INTO oanda_account (key, value, updated_at) VALUES (?, ?, unixepoch())");
    for (const [k, v] of Object.entries(acct)) {
      if (v !== undefined && v !== null) ups.run(k, String(v));
    }
    return parseFloat(String(acct.balance ?? "0"));
  } catch { return 0; }
}

async function syncPositions(): Promise<OandaTrade[]> {
  try {
    const res = await oandaFetch(`${BASE}/v3/accounts/${ACCOUNT_ID}/openTrades`);
    if (!res.ok) return [];
    const data = await res.json() as { trades?: OandaTrade[] };
    const trades = data.trades ?? [];
    const db  = getDb();
    db.prepare("DELETE FROM oanda_positions").run();
    const ins = db.prepare(
      "INSERT OR REPLACE INTO oanda_positions (trade_id, instrument, pair, units, price, stop_loss, take_profit, unrealized_pnl, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())"
    );
    for (const t of trades) {
      ins.run(
        t.id, t.instrument, fromInstrument(t.instrument),
        parseFloat(t.currentUnits), parseFloat(t.price),
        t.stopLossOrder   ? parseFloat(t.stopLossOrder.price)   : null,
        t.takeProfitOrder ? parseFloat(t.takeProfitOrder.price) : null,
        parseFloat(t.unrealizedPL),
      );
    }
    return trades;
  } catch { return []; }
}

async function fetchOandaTradeById(tradeId: string): Promise<OandaTrade | null> {
  try {
    const res = await oandaFetch(`${BASE}/v3/accounts/${ACCOUNT_ID}/trades/${tradeId}`);
    if (!res.ok) return null;
    const data = await res.json() as { trade?: OandaTrade };
    return data.trade ?? null;
  } catch { return null; }
}

// ─── OANDA: sync candles to DB ────────────────────────────────────────────────

async function syncCandles(pair: string): Promise<Candle[]> {
  const instrument = toInstrument(pair);
  const candles    = await fetchOandaCandles(instrument, "M15", 500);
  const db         = getDb();
  const upsert     = db.prepare(
    "INSERT OR REPLACE INTO oanda_candles (pair, tf, time, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertBatch = db.transaction((rows: Candle[]) => {
    for (const c of rows) upsert.run(pair, "15m", c.time, c.open, c.high, c.low, c.close, 0);
  });
  insertBatch(candles.filter(c => c.complete));
  return candles;
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function nowGmt() {
  const d = new Date();
  return {
    hourDecimal: d.getUTCHours() + d.getUTCMinutes() / 60,
    dayOfWeek:   d.getUTCDay(),
    dateStr:     d.toISOString().split("T")[0],
  };
}

function candleGmtHour(ts: number) {
  const d = new Date(ts * 1000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

function candleDateStr(ts: number) {
  return new Date(ts * 1000).toISOString().split("T")[0];
}

// ─── Live trade DB helpers ────────────────────────────────────────────────────

function getOpenLiveTrades(): LiveTrade[] {
  return getDb().prepare("SELECT * FROM oanda_live_trades WHERE status='OPEN'").all() as LiveTrade[];
}

function hasLiveTradeToday(pair: string, today: string): boolean {
  const row = getDb().prepare(
    "SELECT 1 FROM oanda_live_trades WHERE pair=? AND session_date=? AND status IN ('OPEN','CLOSED')"
  ).get(pair, today);
  return row != null;
}

function openLiveTrade(t: {
  pair: string; direction: string; oanda_trade_id: string;
  entry_price: number; stop_loss: number; take_profit: number;
  lot_size: number; units: number; session_date: string;
}): void {
  getDb().prepare(
    `INSERT INTO oanda_live_trades
      (pair, direction, oanda_trade_id, entry_price, stop_loss, take_profit, lot_size, units, session_date)
     VALUES (@pair,@direction,@oanda_trade_id,@entry_price,@stop_loss,@take_profit,@lot_size,@units,@session_date)`
  ).run(t);
}

function closeLiveTrade(id: number, closePrice: number, pnl: number): void {
  getDb().prepare(
    "UPDATE oanda_live_trades SET status='CLOSED', close_price=?, pnl=?, close_time=unixepoch() WHERE id=?"
  ).run(closePrice, pnl, id);
}

function moveLiveTradeBreakeven(id: number, newSl: number): void {
  getDb().prepare(
    "UPDATE oanda_live_trades SET stop_loss=?, breakeven_moved=1 WHERE id=?"
  ).run(newSl, id);
}

// ─── Phase 1: Build Asian range ───────────────────────────────────────────────

async function buildAsianRange(pair: string, today: string, asianStart: number, asianEnd: number) {
  const rows = getDb().prepare(
    "SELECT time, high, low FROM oanda_candles WHERE pair=? AND tf='15m' ORDER BY time ASC"
  ).all(pair) as { time: number; high: number; low: number }[];

  const asian = rows.filter(c =>
    candleDateStr(c.time) === today &&
    candleGmtHour(c.time) >= asianStart &&
    candleGmtHour(c.time) < asianEnd
  );

  if (!asian.length) return;

  const high      = Math.max(...asian.map(c => c.high));
  const low       = Math.min(...asian.map(c => c.low));
  const rangePips = toPips(high, low, pair);
  updateSession(pair, today, { asian_high: high, asian_low: low, range_pips: rangePips });
}

// ─── Phase 2: Breakout detection ─────────────────────────────────────────────

async function checkBreakout(
  pair: string, today: string,
  breakoutStart: number, breakoutEnd: number,
  balance: number,
): Promise<void> {
  const session = getOrCreateSession(pair, today);
  if (session.signal_fired)             return;
  if (hasLiveTradeToday(pair, today))   return;
  if (!session.asian_high || !session.asian_low) return;

  // Risk guards
  const riskState        = getOrCreateRiskState(today);
  const maxConsec        = parseInt(getSetting("strategy_max_consec_losses") || "3");
  const maxDailyLossPct  = parseFloat(getSetting("strategy_max_daily_loss_pct") || "3");
  const startBal         = parseFloat(getSetting("paper_balance") || "10000") / 3.6725;
  const dailyLossPct     = (riskState.daily_pnl / startBal) * 100;

  if (riskState.consecutive_losses >= maxConsec) {
    log(`[${pair}] Consecutive loss limit (${riskState.consecutive_losses}/${maxConsec}) — skipping`);
    return;
  }
  if (dailyLossPct <= -maxDailyLossPct) {
    log(`[${pair}] Daily loss limit (${dailyLossPct.toFixed(2)}%) — skipping`);
    return;
  }

  // Day filter
  const allowedDays = (getSetting("strategy_allowed_days") || "1,2,3,4").split(",").map(d => parseInt(d.trim()));
  if (!allowedDays.includes(nowGmt().dayOfWeek)) return;

  // Range size filter
  const minPips   = parseFloat(getSetting("strategy_min_range_pips") || "15");
  const maxPips   = parseFloat(getSetting("strategy_max_range_pips") || "50");
  const rangePips = toPips(session.asian_high, session.asian_low, pair);
  if (rangePips < minPips || rangePips > maxPips) {
    log(`[${pair}] Range ${rangePips.toFixed(1)} pips outside [${minPips}–${maxPips}] — skipping`);
    return;
  }

  const bufferPips   = parseFloat(getSetting("strategy_entry_buffer_pips") || "2");
  const buffer       = fromPips(bufferPips, pair);
  const tpMultiplier = parseFloat(getSetting("strategy_tp_multiplier") || "1.5");
  const riskPct      = parseFloat(getSetting("risk_per_trade") || "1");
  const atrMult      = parseFloat(getSetting("strategy_atr_sl_multiplier") || "0.3");
  const atrPeriod    = 14;

  // All candles for today from DB
  const allCandles = getDb().prepare(
    "SELECT time, open, high, low, close FROM oanda_candles WHERE pair=? AND tf='15m' ORDER BY time ASC"
  ).all(pair) as { time: number; open: number; high: number; low: number; close: number }[];

  // ATR-buffered SL
  const preBo  = allCandles.filter(c => candleDateStr(c.time) === today && candleGmtHour(c.time) < breakoutStart).slice(-(atrPeriod + 1));
  const atr    = calcATR(preBo, atrPeriod);
  const slBuf  = Math.max(buffer, atr * atrMult);

  // Breakout window candles
  const boCandids = allCandles.filter(c =>
    candleDateStr(c.time) === today &&
    candleGmtHour(c.time) >= breakoutStart &&
    candleGmtHour(c.time) < breakoutEnd
  );

  if (!boCandids.length) return;

  // False breakout: both sides pierced
  const bothBroken = boCandids.some(c => c.close > session.asian_high! + buffer)
                  && boCandids.some(c => c.close < session.asian_low!  - buffer);
  if (bothBroken) {
    log(`[${pair}] Both sides broken — false breakout, skipping`);
    updateSession(pair, today, { skipped_reason: "Both sides broken (false breakout)" });
    return;
  }

  const rangeSize = session.asian_high - session.asian_low;
  const bal       = balance > 0 ? balance : startBal;

  for (const c of boCandids) {
    let direction: "LONG" | "SHORT" | null = null;
    let entry: number, sl: number, tp: number;

    if (c.close > session.asian_high + buffer) {
      direction = "LONG";
      entry = session.asian_high + buffer;
      sl    = session.asian_low  - slBuf;
      tp    = entry + rangeSize * tpMultiplier;
    } else if (c.close < session.asian_low - buffer) {
      direction = "SHORT";
      entry = session.asian_low  - buffer;
      sl    = session.asian_high + slBuf;
      tp    = entry - rangeSize * tpMultiplier;
    }

    if (!direction) continue;

    const lot   = calcLotSize(bal, riskPct, entry!, sl!, pair);
    const units = lotsToUnits(lot, direction);

    log(`[${pair}] SIGNAL ${direction} @ ${entry!.toFixed(5)} SL:${sl!.toFixed(5)} TP:${tp!.toFixed(5)} lot:${lot} units:${units}`);
    stratLog("SIGNAL", `[OANDA] [${pair}] ${direction} @ ${entry!.toFixed(5)} SL:${sl!.toFixed(5)} TP:${tp!.toFixed(5)} lot:${lot}`, pair);

    if (DRY_RUN) {
      log(`[${pair}] DRY_RUN — order not placed. Set OANDA_DRY_RUN=false to trade live.`);
      updateSession(pair, today, { signal_fired: 1, breakout_direction: direction });
      return;
    }

    // Place market order via OANDA v20
    const body = {
      order: {
        type: "MARKET",
        instrument: toInstrument(pair),
        units: String(units),
        stopLossOnFill:   { price: sl!.toFixed(5),  timeInForce: "GTC" },
        takeProfitOnFill: { price: tp!.toFixed(5),  timeInForce: "GTC" },
        timeInForce: "FOK",
      },
    };

    try {
      const res  = await oandaFetch(`${BASE}/v3/accounts/${ACCOUNT_ID}/orders`, { method: "POST", body: JSON.stringify(body) });
      const data = await res.json() as {
        orderFillTransaction?:   { tradeOpened?: { tradeID: string }; price?: string };
        orderCancelTransaction?: { reason?: string };
      };

      if (!res.ok || data.orderCancelTransaction) {
        const reason = data.orderCancelTransaction?.reason ?? `HTTP ${res.status}`;
        log(`[${pair}] Order cancelled: ${reason}`);
        stratLog("WARN", `[OANDA] [${pair}] Order cancelled: ${reason}`, pair);
        return;
      }

      const fill    = data.orderFillTransaction!;
      const tradeId = fill.tradeOpened?.tradeID ?? "unknown";
      const fillPx  = parseFloat(fill.price ?? String(entry));

      log(`[${pair}] Filled — tradeId:${tradeId} @ ${fillPx}`);
      stratLog("TRADE", `[OANDA] [${pair}] ${direction} filled tradeId:${tradeId} @ ${fillPx}`, pair);

      openLiveTrade({
        pair, direction, oanda_trade_id: tradeId,
        entry_price: fillPx, stop_loss: sl!, take_profit: tp!,
        lot_size: lot, units, session_date: today,
      });
      updateSession(pair, today, { signal_fired: 1, breakout_direction: direction });
      updateRiskState(today, { daily_trades: riskState.daily_trades + 1 });

    } catch (e) {
      log(`[${pair}] Order error: ${e}`);
      stratLog("WARN", `[OANDA] [${pair}] Order error: ${e}`, pair);
    }

    return; // only act on the first breakout candle
  }
}

// ─── Phase 3: Trade management ────────────────────────────────────────────────

async function manageLiveTrades(today: string, cutoffHour: number, hourDecimal: number, oandaTrades: OandaTrade[]) {
  const openLive = getOpenLiveTrades();
  if (!openLive.length) return;

  const oandaMap = new Map(oandaTrades.map(t => [t.id, t]));

  for (const live of openLive) {
    const isLiveInOanda = live.oanda_trade_id ? oandaMap.has(live.oanda_trade_id) : false;

    // Trade closed by OANDA (SL or TP hit by broker)
    if (!isLiveInOanda && live.oanda_trade_id) {
      const closed = await fetchOandaTradeById(live.oanda_trade_id);
      if (closed && closed.state !== "OPEN") {
        const closePrice = parseFloat(closed.averageClosePrice ?? String(live.entry_price));
        const pnl        = parseFloat(closed.realizedPL ?? "0");
        closeLiveTrade(live.id, closePrice, pnl);

        const riskState = getOrCreateRiskState(today);
        const isLoss    = pnl < 0;
        updateRiskState(today, {
          daily_pnl:          riskState.daily_pnl + pnl,
          daily_trades:       riskState.daily_trades + 1,
          consecutive_losses: isLoss ? riskState.consecutive_losses + 1 : 0,
        });

        const icon = pnl >= 0 ? "TP hit" : "SL hit";
        log(`[${live.pair}] ${icon} — tradeId:${live.oanda_trade_id} realizedPL:${pnl.toFixed(2)}`);
        stratLog("TRADE", `[OANDA] [${live.pair}] ${icon} — P&L ${pnl.toFixed(2)}`, live.pair);
      }
      continue;
    }

    if (!isLiveInOanda) continue; // dry-run trade with no OANDA ID

    // Force-close at 12:00 cutoff
    if (hourDecimal >= cutoffHour) {
      log(`[${live.pair}] 12:00 cutoff — closing tradeId:${live.oanda_trade_id}`);
      try {
        const res  = await oandaFetch(
          `${BASE}/v3/accounts/${ACCOUNT_ID}/trades/${live.oanda_trade_id}/close`,
          { method: "PUT", body: "{}" }
        );
        const data = await res.json() as { orderFillTransaction?: { price?: string; pl?: string } };
        const fill = data.orderFillTransaction;
        const closePrice = parseFloat(fill?.price  ?? String(live.entry_price));
        const pnl        = parseFloat(fill?.pl     ?? "0");

        closeLiveTrade(live.id, closePrice, pnl);
        const riskState = getOrCreateRiskState(today);
        updateRiskState(today, {
          daily_pnl:          riskState.daily_pnl + pnl,
          daily_trades:       riskState.daily_trades + 1,
          consecutive_losses: pnl < 0 ? riskState.consecutive_losses + 1 : 0,
        });
        stratLog("TRADE", `[OANDA] [${live.pair}] Time cutoff close — P&L ${pnl.toFixed(2)}`, live.pair);
      } catch (e) {
        log(`[${live.pair}] Force-close error: ${e}`);
      }
      continue;
    }

    // Breakeven: move SL to entry once price has moved 1R in profit
    if (!live.breakeven_moved) {
      const breakevenR = parseFloat(getSetting("strategy_breakeven_r") || "1");
      const isLong     = live.direction === "LONG";
      const riskPips   = toPips(live.entry_price, live.stop_loss, live.pair);

      const latestRow = getDb().prepare(
        "SELECT close FROM oanda_candles WHERE pair=? AND tf='15m' ORDER BY time DESC LIMIT 1"
      ).get(live.pair) as { close: number } | undefined;

      if (latestRow) {
        const profitPips = isLong
          ? (latestRow.close - live.entry_price) / pipSize(live.pair)
          : (live.entry_price - latestRow.close) / pipSize(live.pair);

        if (profitPips >= riskPips * breakevenR) {
          const newSl = live.entry_price;
          log(`[${live.pair}] Breakeven — moving SL to entry ${newSl.toFixed(5)} (${profitPips.toFixed(1)} pips)`);
          try {
            await oandaFetch(
              `${BASE}/v3/accounts/${ACCOUNT_ID}/trades/${live.oanda_trade_id}/orders`,
              {
                method: "PUT",
                body: JSON.stringify({ stopLoss: { price: newSl.toFixed(5), timeInForce: "GTC" } }),
              }
            );
            moveLiveTradeBreakeven(live.id, newSl);
            stratLog("TRADE", `[OANDA] [${live.pair}] Breakeven — SL moved to ${newSl.toFixed(5)}`, live.pair);
          } catch (e) {
            log(`[${live.pair}] Breakeven SL move error: ${e}`);
          }
        }
      }
    }
  }
}

// ─── Main tick ────────────────────────────────────────────────────────────────

async function tick() {
  const { hourDecimal, dayOfWeek, dateStr } = nowGmt();

  const isWeekend = dayOfWeek === 6 || (dayOfWeek === 0 && hourDecimal < 22) || (dayOfWeek === 5 && hourDecimal >= 22);
  if (isWeekend) { log("Market closed (weekend)"); return; }

  const asianStart    = parseFloat(getSetting("strategy_asian_start")    || "2");
  const asianEnd      = parseFloat(getSetting("strategy_asian_end")      || "7");
  const breakoutStart = parseFloat(getSetting("strategy_breakout_start") || "8");
  const breakoutEnd   = parseFloat(getSetting("strategy_breakout_end")   || "10");
  const cutoffHour    = parseFloat(getSetting("strategy_close_cutoff")   || "12");
  const pairs         = (getSetting("strategy_pairs") || "EURUSD,GBPUSD").split(",").map(p => p.trim().toUpperCase());

  let phase = "IDLE";
  if      (hourDecimal >= asianStart    && hourDecimal < asianEnd)    phase = "ASIAN_RANGE";
  else if (hourDecimal >= breakoutStart && hourDecimal < breakoutEnd) phase = "BREAKOUT_WATCH";
  else if (hourDecimal >= breakoutEnd   && hourDecimal < cutoffHour)  phase = "MANAGING";
  else if (hourDecimal >= cutoffHour)                                 phase = "CLOSED";

  log(`Tick — phase:${phase}  pairs:${pairs.join(",")}${DRY_RUN ? "  [DRY RUN]" : ""}`);

  // Sync OANDA state
  const balance     = await syncAccount();
  const oandaTrades = await syncPositions();
  for (const pair of pairs) await syncCandles(pair);

  // Per-pair strategy
  for (const pair of pairs) {
    getOrCreateSession(pair, dateStr);

    if (phase === "ASIAN_RANGE" || phase === "BREAKOUT_WATCH") {
      await buildAsianRange(pair, dateStr, asianStart, asianEnd);
    }

    if (phase === "BREAKOUT_WATCH") {
      await checkBreakout(pair, dateStr, breakoutStart, breakoutEnd, balance);
    }

    if (phase === "MANAGING" || phase === "CLOSED") {
      await manageLiveTrades(dateStr, cutoffHour, hourDecimal, oandaTrades);
    }
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

log(`Starting OANDA bridge`);
log(`  Env:      ${OANDA_ENV}`);
log(`  Account:  ${ACCOUNT_ID}`);
log(`  Base URL: ${BASE}`);
log(`  DRY_RUN:  ${DRY_RUN}${DRY_RUN ? "  (set OANDA_DRY_RUN=false to place real orders)" : ""}`);

initOandaTables();

tick().catch(e => log(`[ERROR] Tick failed: ${e}`));
const timer = setInterval(() => tick().catch(e => log(`[ERROR] Tick failed: ${e}`)), 60_000);

process.stdin.resume();
process.on("SIGINT", () => {
  log("Shutting down (SIGINT)…");
  clearInterval(timer);
  process.exit(0);
});
