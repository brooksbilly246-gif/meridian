import Database from "better-sqlite3";
import path from "path";
import { AED_RATE } from "./currency";

const DB_PATH = path.join(process.cwd(), "meridian.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('LONG','SHORT')),
      entry_price REAL,
      stop_loss REAL,
      take_profit REAL,
      lot_size REAL DEFAULT 0.1,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','OPEN','CLOSED','CANCELLED')),
      pnl REAL DEFAULT 0,
      pnl_pips REAL DEFAULT 0,
      open_time INTEGER,
      close_time INTEGER,
      close_price REAL,
      signal_source TEXT DEFAULT 'TRADINGVIEW',
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair TEXT NOT NULL,
      direction TEXT NOT NULL,
      timeframe TEXT,
      entry_price REAL,
      stop_loss REAL,
      take_profit REAL,
      trigger_at INTEGER,
      notified_15m INTEGER DEFAULT 0,
      notified_5m INTEGER DEFAULT 0,
      notified_1m INTEGER DEFAULT 0,
      executed INTEGER DEFAULT 0,
      raw_payload TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategy_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair TEXT NOT NULL,
      session_date TEXT NOT NULL,
      asian_high REAL,
      asian_low REAL,
      range_pips REAL,
      breakout_direction TEXT,
      signal_fired INTEGER DEFAULT 0,
      skipped_reason TEXT,
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(pair, session_date)
    );

    CREATE TABLE IF NOT EXISTS risk_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      daily_pnl REAL DEFAULT 0,
      daily_trades INTEGER DEFAULT 0,
      consecutive_losses INTEGER DEFAULT 0,
      circuit_broken INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS strategy_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'INFO',
      message TEXT NOT NULL,
      pair TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS trade_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      trades INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      win_rate REAL DEFAULT 0,
      avg_pips REAL DEFAULT 0,
      net_pnl REAL DEFAULT 0,
      rating TEXT DEFAULT 'INSUFFICIENT',
      suggestion_key TEXT,
      suggestion_value TEXT,
      suggestion_reason TEXT,
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(category, label)
    );

    CREATE TABLE IF NOT EXISTS ibkr_candles (
      pair TEXT NOT NULL,
      tf TEXT NOT NULL,
      time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL,
      PRIMARY KEY (pair, tf, time)
    );

    CREATE TABLE IF NOT EXISTS ibkr_account (
      key TEXT PRIMARY KEY,
      value TEXT,
      currency TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ibkr_positions (
      symbol TEXT PRIMARY KEY,
      pair TEXT,
      sec_type TEXT,
      position REAL NOT NULL,
      avg_cost REAL,
      currency TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ibkr_candles (
      pair TEXT NOT NULL,
      tf TEXT NOT NULL,
      time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL,
      PRIMARY KEY (pair, tf, time)
    );

    CREATE TABLE IF NOT EXISTS ibkr_account (
      key TEXT PRIMARY KEY,
      value TEXT,
      currency TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ibkr_positions (
      symbol TEXT PRIMARY KEY,
      pair TEXT,
      sec_type TEXT,
      position REAL NOT NULL,
      avg_cost REAL,
      currency TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS setting_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      insight_category TEXT NOT NULL,
      insight_label TEXT NOT NULL,
      setting_key TEXT NOT NULL,
      old_value TEXT NOT NULL,
      new_value TEXT NOT NULL,
      reason TEXT,
      reverted INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  const defaults: Record<string, string> = {
    paper_balance:              "10000",
    imessage_target:            "",
    webhook_secret:             "",
    risk_per_trade:             "2", // intentional default — 2% risk per trade
    default_lot_size:           "0.1",
    strategy_enabled:           "false",
    strategy_pairs:             "EURUSD,GBPUSD",
    strategy_asian_start:       "2",
    strategy_asian_end:         "7",
    strategy_breakout_start:    "8",
    strategy_breakout_end:      "10",
    strategy_close_cutoff:      "12",
    strategy_min_range_pips:    "15",
    strategy_max_range_pips:    "50",
    strategy_entry_buffer_pips: "2",
    strategy_tp_multiplier:     "1.5",
    strategy_breakeven_r:       "1",
    strategy_trend_filter:      "false",
    strategy_allowed_days:      "1,2,3,4",
    strategy_max_daily_loss_pct:"3",
    strategy_max_consec_losses: "3",
    strategy_max_portfolio_heat:"5",
    strategy_correlation_filter:"true",
  };

  const upsert = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(defaults)) upsert.run(k, v);
}

// ─── Settings ────────────────────────────────────────────────────────────────
export function getSetting(key: string): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? "";
}
export function setSetting(key: string, value: string) {
  getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}
export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ─── Signals ─────────────────────────────────────────────────────────────────
export function insertSignal(sig: {
  pair: string; direction: string; timeframe?: string;
  entry_price?: number; stop_loss?: number; take_profit?: number;
  trigger_at?: number; raw_payload?: string;
}) {
  return getDb().prepare(
    `INSERT INTO signals (pair, direction, timeframe, entry_price, stop_loss, take_profit, trigger_at, raw_payload)
     VALUES (@pair,@direction,@timeframe,@entry_price,@stop_loss,@take_profit,@trigger_at,@raw_payload)`
  ).run(sig);
}
export function getPendingSignals() {
  return getDb().prepare("SELECT * FROM signals WHERE executed = 0 ORDER BY created_at DESC").all();
}
export function getSignalById(id: number) {
  return getDb().prepare("SELECT * FROM signals WHERE id = ?").get(id);
}
export function markSignalNotified(id: number, window: "15m" | "5m" | "1m") {
  const col = window === "15m" ? "notified_15m" : window === "5m" ? "notified_5m" : "notified_1m";
  getDb().prepare(`UPDATE signals SET ${col} = 1 WHERE id = ?`).run(id);
}
export function markSignalExecuted(id: number) {
  getDb().prepare("UPDATE signals SET executed = 1 WHERE id = ?").run(id);
}

// ─── Trades ───────────────────────────────────────────────────────────────────
export function openTrade(t: {
  pair: string; direction: string; entry_price: number;
  stop_loss?: number; take_profit?: number; lot_size?: number; signal_source?: string;
}) {
  return getDb().prepare(
    `INSERT INTO trades (pair, direction, entry_price, stop_loss, take_profit, lot_size, status, open_time, signal_source)
     VALUES (@pair,@direction,@entry_price,@stop_loss,@take_profit,@lot_size,'OPEN',unixepoch(),@signal_source)`
  ).run({ lot_size: 0.1, signal_source: "TRADINGVIEW", ...t });
}
export function updateTradeStopLoss(id: number, new_sl: number) {
  getDb().prepare("UPDATE trades SET stop_loss = ? WHERE id = ?").run(new_sl, id);
}
export function closeTrade(id: number, close_price: number, pnl: number, pnl_pips: number) {
  getDb().prepare(
    `UPDATE trades SET status='CLOSED', close_price=?, pnl=?, pnl_pips=?, close_time=unixepoch() WHERE id=?`
  ).run(close_price, pnl, pnl_pips, id);
}
export function getOpenTrades() {
  return getDb().prepare("SELECT * FROM trades WHERE status='OPEN' ORDER BY open_time DESC").all();
}
export function getAllTrades(limit = 100) {
  return getDb().prepare("SELECT * FROM trades ORDER BY created_at DESC LIMIT ?").all(limit);
}
export function hasTradeOnPairToday(pair: string, date: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM trades WHERE pair=? AND status IN ('OPEN','CLOSED') AND date(datetime(open_time,'unixepoch'))=?")
    .get(pair, date);
  return row != null;
}

// ─── Stats ────────────────────────────────────────────────────────────────────
export function getStats() {
  const db = getDb();
  const closed = db.prepare("SELECT * FROM trades WHERE status='CLOSED'").all() as {
    pnl: number; pnl_pips: number; direction: string; pair: string;
  }[];
  const open = db.prepare("SELECT COUNT(*) as cnt FROM trades WHERE status='OPEN'").get() as { cnt: number };
  const wins   = closed.filter((t) => t.pnl > 0).length;
  const losses = closed.filter((t) => t.pnl <= 0).length;
  const totalPnl  = closed.reduce((s, t) => s + t.pnl, 0);
  const totalPips = closed.reduce((s, t) => s + t.pnl_pips, 0);
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
  const balance = parseFloat(getSetting("paper_balance") || "10000") / AED_RATE + totalPnl;
  return {
    balance: balance.toFixed(2),
    totalPnl: totalPnl.toFixed(2),
    totalPips: totalPips.toFixed(1),
    winRate: winRate.toFixed(1),
    totalTrades: closed.length,
    wins, losses,
    openTrades: open.cnt,
  };
}
export function getPnlHistory() {
  const db = getDb();
  const trades = db.prepare(
    "SELECT pnl, close_time FROM trades WHERE status='CLOSED' ORDER BY close_time ASC"
  ).all() as { pnl: number; close_time: number }[];
  let running = 0;
  return trades.map((t) => {
    running += t.pnl;
    return { time: new Date(t.close_time * 1000).toLocaleDateString(), pnl: parseFloat(running.toFixed(2)) };
  });
}

// ─── Strategy Sessions ────────────────────────────────────────────────────────
export function getOrCreateSession(pair: string, date: string) {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO strategy_sessions (pair, session_date) VALUES (?, ?)`
  ).run(pair, date);
  return db.prepare("SELECT * FROM strategy_sessions WHERE pair=? AND session_date=?").get(pair, date) as StrategySession;
}
export function updateSession(pair: string, date: string, data: Partial<StrategySession>) {
  const sets = Object.keys(data).map((k) => `${k}=@${k}`).join(", ");
  getDb().prepare(
    `UPDATE strategy_sessions SET ${sets}, updated_at=unixepoch() WHERE pair=@pair AND session_date=@date`
  ).run({ ...data, pair, date });
}
export function getAllSessions(date: string) {
  return getDb().prepare("SELECT * FROM strategy_sessions WHERE session_date=?").all(date) as StrategySession[];
}

// ─── Risk State ───────────────────────────────────────────────────────────────
export function getOrCreateRiskState(date: string): RiskState {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO risk_state (date) VALUES (?)").run(date);
  return db.prepare("SELECT * FROM risk_state WHERE date=?").get(date) as RiskState;
}
export function updateRiskState(date: string, data: Partial<RiskState>) {
  const sets = Object.keys(data).map((k) => `${k}=@${k}`).join(", ");
  getDb().prepare(
    `UPDATE risk_state SET ${sets}, updated_at=unixepoch() WHERE date=@date`
  ).run({ ...data, date });
}

// ─── Strategy Log ─────────────────────────────────────────────────────────────
export function stratLog(level: "INFO" | "WARN" | "SIGNAL" | "TRADE" | "RISK", message: string, pair?: string) {
  getDb().prepare(
    "INSERT INTO strategy_log (level, message, pair) VALUES (?, ?, ?)"
  ).run(level, message, pair ?? null);
}
export function getStrategyLog(limit = 50) {
  return getDb().prepare(
    "SELECT * FROM strategy_log ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as StrategyLogEntry[];
}

// ─── Trade Insights ───────────────────────────────────────────────────────────
export type InsightRow = {
  category: string; label: string;
  trades: number; wins: number; losses: number;
  win_rate: number; avg_pips: number; net_pnl: number;
  rating: string;
  suggestion_key: string | null; suggestion_value: string | null; suggestion_reason: string | null;
};

export function clearInsights() {
  getDb().prepare("DELETE FROM trade_insights").run();
}

export function upsertInsight(ins: InsightRow) {
  getDb().prepare(`
    INSERT OR REPLACE INTO trade_insights
    (category, label, trades, wins, losses, win_rate, avg_pips, net_pnl, rating,
     suggestion_key, suggestion_value, suggestion_reason, updated_at)
    VALUES (@category,@label,@trades,@wins,@losses,@win_rate,@avg_pips,@net_pnl,@rating,
            @suggestion_key,@suggestion_value,@suggestion_reason,unixepoch())
  `).run(ins);
}

export function getInsights(): InsightRow[] {
  return getDb().prepare(
    "SELECT * FROM trade_insights ORDER BY category, win_rate DESC"
  ).all() as InsightRow[];
}

export function getClosedTradesWithSession() {
  return getDb().prepare(`
    SELECT t.pair, t.direction, t.pnl, t.pnl_pips, t.open_time, s.range_pips
    FROM trades t
    LEFT JOIN strategy_sessions s
      ON s.pair = t.pair AND s.session_date = date(t.open_time, 'unixepoch')
    WHERE t.status = 'CLOSED' AND t.signal_source = 'LONDON_BREAKOUT'
  `).all() as { pair: string; direction: string; pnl: number; pnl_pips: number; open_time: number; range_pips: number | null }[];
}

// ─── Setting Changes (suggestion history) ────────────────────────────────
export type SettingChange = {
  id: number; insight_category: string; insight_label: string;
  setting_key: string; old_value: string; new_value: string;
  reason: string | null; reverted: number; created_at: number;
};

export function applyInsightSuggestion(
  category: string, label: string, key: string, newValue: string, reason: string | null
): SettingChange {
  const db = getDb();
  const oldValue = getSetting(key);
  db.prepare(`
    INSERT INTO setting_changes (insight_category, insight_label, setting_key, old_value, new_value, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(category, label, key, oldValue, newValue, reason);
  setSetting(key, newValue);
  const row = db.prepare("SELECT * FROM setting_changes ORDER BY id DESC LIMIT 1").get() as SettingChange;
  return row;
}

export function revertSettingChange(id: number): boolean {
  const db = getDb();
  const row = db.prepare("SELECT * FROM setting_changes WHERE id = ? AND reverted = 0").get(id) as SettingChange | undefined;
  if (!row) return false;
  setSetting(row.setting_key, row.old_value);
  db.prepare("UPDATE setting_changes SET reverted = 1 WHERE id = ?").run(id);
  return true;
}

export function getSettingChanges(): SettingChange[] {
  return getDb().prepare(
    "SELECT * FROM setting_changes ORDER BY created_at DESC"
  ).all() as SettingChange[];
}

export function getActiveSettingChanges(): SettingChange[] {
  return getDb().prepare(
    "SELECT * FROM setting_changes WHERE reverted = 0 ORDER BY created_at DESC"
  ).all() as SettingChange[];
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type StrategySession = {
  id: number; pair: string; session_date: string;
  asian_high: number | null; asian_low: number | null; range_pips: number | null;
  breakout_direction: string | null; signal_fired: number; skipped_reason: string | null;
  updated_at: number;
};
export type RiskState = {
  id: number; date: string; daily_pnl: number; daily_trades: number;
  consecutive_losses: number; circuit_broken: number; updated_at: number;
};
export type StrategyLogEntry = {
  id: number; level: string; message: string; pair: string | null; created_at: number;
};

// ─── IBKR Data ────────────────────────────────────────────────────────────────
export type IbkrCandle = { time: number; open: number; high: number; low: number; close: number; volume: number | null };
export type IbkrPosition = { symbol: string; pair: string | null; sec_type: string; position: number; avg_cost: number | null; currency: string | null; updated_at: number };
export type IbkrAccountRow = { key: string; value: string | null; currency: string | null };

export function getIbkrCandles(pair: string, tf: string, limit = 750): IbkrCandle[] {
  return getDb().prepare(
    `SELECT time, open, high, low, close, volume FROM ibkr_candles
     WHERE pair = ? AND tf = ? ORDER BY time ASC LIMIT ?`
  ).all(pair, tf, limit) as IbkrCandle[];
}

export function getIbkrAccount(): IbkrAccountRow[] {
  return getDb().prepare("SELECT key, value, currency FROM ibkr_account").all() as IbkrAccountRow[];
}

export function getIbkrPositions(): IbkrPosition[] {
  return getDb().prepare("SELECT * FROM ibkr_positions ORDER BY symbol").all() as IbkrPosition[];
}

export function hasIbkrCandles(pair: string, tf: string): boolean {
  const row = getDb().prepare(
    "SELECT 1 FROM ibkr_candles WHERE pair = ? AND tf = ? LIMIT 1"
  ).get(pair, tf);
  return row != null;
}
