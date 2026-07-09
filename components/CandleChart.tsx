"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type CandlestickData,
  type SeriesMarker,
  type IPriceLine,
  type Time,
  LineStyle,
} from "lightweight-charts";
import { formatAED } from "@/lib/currency";
import { ChartOverlayPrimitive } from "@/components/ChartOverlay";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type Signal = { id: number; pair: string; direction: string; entry_price: number | null; stop_loss: number | null; take_profit: number | null; created_at: number; executed: number };
type Trade  = { id: number; pair: string; direction: string; entry_price: number; stop_loss: number | null; take_profit: number | null; close_price: number | null; pnl: number; status: string; open_time: number; close_time: number | null };

const PAIRS = ["EURUSD","GBPUSD","USDJPY","AUDUSD","USDCAD","USDCHF","NZDUSD","EURGBP"];
const TIMEFRAMES = ["1m","5m","15m","1h","4h","1d"];
const FMT = (pair: string, v: number) => v.toFixed(pair.includes("JPY") ? 3 : 5);

// Forex is closed Saturday all day, Sunday before ~22:00 UTC, Friday after ~22:00 UTC
function marketStatus(): { closed: boolean; label: string; opensIn?: string } {
  const now   = new Date();
  const day   = now.getUTCDay();   // 0=Sun 1=Mon … 5=Fri 6=Sat
  const hour  = now.getUTCHours();
  const min   = now.getUTCMinutes();
  const hDec  = hour + min / 60;

  if (day === 6) {
    // Saturday — closed all day. Opens Sunday ~22:00 UTC
    const hoursLeft = (22 - hDec + 24) % 24;
    return { closed: true, label: "Market closed — weekend", opensIn: `~${Math.round(hoursLeft)}h` };
  }
  if (day === 0 && hDec < 22) {
    // Sunday before 22:00 UTC
    const hoursLeft = 22 - hDec;
    return { closed: true, label: "Market closed — weekend", opensIn: `~${Math.round(hoursLeft)}h` };
  }
  if (day === 5 && hDec >= 22) {
    return { closed: true, label: "Market closed — weekend starts now", opensIn: "~47h" };
  }
  return { closed: false, label: "Market open" };
}

function nearestCandleTime(ts: number, candles: Candle[]): number {
  if (!candles.length) return ts;
  return candles.reduce((best, c) =>
    Math.abs(c.time - ts) < Math.abs(best.time - ts) ? c : best
  ).time;
}

function riskReward(entry: number | null, sl: number | null, tp: number | null): string | null {
  if (!entry || !sl || !tp) return null;
  const risk   = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk === 0) return null;
  return `1 : ${(reward / risk).toFixed(2)}`;
}

export default function CandleChart({ pair: initPair, tf: initTf, height = 420 }: { pair: string; tf: string; height?: number }) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const chartRef        = useRef<IChartApi | null>(null);
  const candleRef       = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef          = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLines      = useRef<IPriceLine[]>([]);
  const markersPlugin   = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const overlayRef      = useRef<ChartOverlayPrimitive | null>(null);
  const candlesCache    = useRef<Candle[]>([]);

  const [pair, setPair]         = useState(initPair);
  const [tf, setTf]             = useState(initTf);
  const [loading, setLoad]      = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [lastCandle, setLast]   = useState<Candle | null>(null);
  const [annotations, setAnnot] = useState<{ signals: Signal[]; trades: Trade[] }>({ signals: [], trades: [] });
  const [market]                = useState(marketStatus);
  const [stratSession, setStratSession] = useState<{ asian_high: number | null; asian_low: number | null }>({ asian_high: null, asian_low: null });

  // Init chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { color: "transparent" }, textColor: "#6b6b8a", fontSize: 11 },
      grid: { vertLines: { color: "#1e1e3a" }, horzLines: { color: "#1e1e3a" } },
      crosshair: { vertLine: { color: "#00d4ff44" }, horzLine: { color: "#00d4ff44" } },
      rightPriceScale: { borderColor: "#1e1e3a" },
      timeScale: { borderColor: "#1e1e3a", timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: height - 90,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00ff88", downColor: "#ff3366",
      borderUpColor: "#00ff88", borderDownColor: "#ff3366",
      wickUpColor: "#00ff8888", wickDownColor: "#ff336688",
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      color: "#00d4ff22", priceFormat: { type: "volume" }, priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    chartRef.current      = chart;
    candleRef.current     = candleSeries;
    volRef.current        = volSeries;
    markersPlugin.current = createSeriesMarkers(candleSeries, []);

    const overlay = new ChartOverlayPrimitive();
    candleSeries.attachPrimitive(overlay);
    overlayRef.current = overlay;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, [height]);

  // Draw markers + price lines
  const drawAnnotations = useCallback(() => {
    const series = candleRef.current;
    if (!series || !candlesCache.current.length) return;

    priceLines.current.forEach((l) => { try { series.removePriceLine(l); } catch {} });
    priceLines.current = [];

    const markers: SeriesMarker<Time>[] = [];

    // ── Pending signals (upcoming setups) ─────────────────────────────────────
    for (const sig of annotations.signals.filter((s) => !s.executed)) {
      const t      = nearestCandleTime(sig.created_at, candlesCache.current) as Time;
      const isLong = sig.direction === "LONG";

      markers.push({
        time: t,
        position: isLong ? "belowBar" : "aboveBar",
        color: isLong ? "#00ff88" : "#ff3366",
        shape: isLong ? "arrowUp" : "arrowDown",
        text: `${sig.direction} SETUP`,
        size: 2,
      });

      // Entry line — solid, prominent
      if (sig.entry_price != null) {
        priceLines.current.push(series.createPriceLine({
          price: sig.entry_price,
          color: "#00d4ff",
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          title: `⟶ Entry  ${FMT(pair, sig.entry_price)}`,
          axisLabelVisible: true,
        }));
      }
      // Stop loss — red dashed, clear label with price
      if (sig.stop_loss != null) {
        priceLines.current.push(series.createPriceLine({
          price: sig.stop_loss,
          color: "#ff3366",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          title: `✕ SL  ${FMT(pair, sig.stop_loss)}`,
          axisLabelVisible: true,
        }));
      }
      // Take profit — green dashed, clear label with price
      if (sig.take_profit != null) {
        priceLines.current.push(series.createPriceLine({
          price: sig.take_profit,
          color: "#00ff88",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          title: `✓ TP  ${FMT(pair, sig.take_profit)}`,
          axisLabelVisible: true,
        }));
      }
    }

    // ── Open trades ───────────────────────────────────────────────────────────
    for (const trade of annotations.trades.filter((t) => t.status === "OPEN")) {
      const isLong = trade.direction === "LONG";

      if (trade.open_time) {
        markers.push({
          time: nearestCandleTime(trade.open_time, candlesCache.current) as Time,
          position: isLong ? "belowBar" : "aboveBar",
          color: isLong ? "#00ff88" : "#ff3366",
          shape: isLong ? "arrowUp" : "arrowDown",
          text: `${trade.direction} OPEN`,
          size: 2,
        });
      }

      priceLines.current.push(series.createPriceLine({
        price: trade.entry_price,
        color: "#00d4ff",
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        title: `⟶ Entry  ${FMT(pair, trade.entry_price)}`,
        axisLabelVisible: true,
      }));
      if (trade.stop_loss != null) {
        priceLines.current.push(series.createPriceLine({
          price: trade.stop_loss,
          color: "#ff3366",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          title: `✕ SL  ${FMT(pair, trade.stop_loss)}`,
          axisLabelVisible: true,
        }));
      }
      if (trade.take_profit != null) {
        priceLines.current.push(series.createPriceLine({
          price: trade.take_profit,
          color: "#00ff88",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          title: `✓ TP  ${FMT(pair, trade.take_profit)}`,
          axisLabelVisible: true,
        }));
      }
    }

    // ── Closed trades (entry + exit markers only, no price lines) ─────────────
    for (const trade of annotations.trades.filter((t) => t.status === "CLOSED")) {
      const isLong = trade.direction === "LONG";
      if (trade.open_time) {
        markers.push({
          time: nearestCandleTime(trade.open_time, candlesCache.current) as Time,
          position: isLong ? "belowBar" : "aboveBar",
          color: "#6b6b8a",
          shape: isLong ? "arrowUp" : "arrowDown",
          text: trade.direction,
          size: 1,
        });
      }
      if (trade.close_time) {
        const won = trade.pnl >= 0;
        markers.push({
          time: nearestCandleTime(trade.close_time, candlesCache.current) as Time,
          position: isLong ? "aboveBar" : "belowBar",
          color: won ? "#00ff88" : "#ff3366",
          shape: "circle",
          text: `${won ? "✓" : "✗"} ${formatAED(trade.pnl)}`,
          size: 1,
        });
      }
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markersPlugin.current?.setMarkers(markers);

    // Push data to canvas overlay primitive
    overlayRef.current?.update({
      signals:   annotations.signals,
      trades:    annotations.trades,
      candles:   candlesCache.current,
      asianHigh: stratSession.asian_high,
      asianLow:  stratSession.asian_low,
      todayStr:  new Date().toISOString().split("T")[0],
    });
  }, [annotations, pair, stratSession]);

  // Fetch candles
  useEffect(() => {
    let alive = true;
    setLoad(true);
    setError(null);

    const load = () =>
      fetch(`/api/candles?pair=${pair}&tf=${tf}`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          if (d.error) { setError(d.error); setLoad(false); return; }
          const raw: Candle[] = d.candles;
          candlesCache.current = raw;
          const candles: CandlestickData<Time>[] = raw.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close }));
          const volumes = raw.map((c) => ({ time: c.time as Time, value: c.volume ?? 0, color: c.close >= c.open ? "#00ff8818" : "#ff336618" }));
          candleRef.current?.setData(candles);
          volRef.current?.setData(volumes);
          chartRef.current?.timeScale().fitContent();
          setLast(raw.at(-1) ?? null);
          setLoad(false);
        })
        .catch((e) => { if (alive) { setError(String(e)); setLoad(false); } });

    load();
    const interval = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(interval); };
  }, [pair, tf]);

  // Fetch annotations
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/annotations?pair=${pair}`)
        .then((r) => r.json())
        .then((d) => { if (alive) setAnnot(d); })
        .catch(() => {});
    load();
    const interval = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(interval); };
  }, [pair]);

  // Fetch strategy session (Asian range high/low)
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/strategy/state")
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          const sess = (d.sessions ?? []).find((s: { pair: string }) => s.pair === pair);
          setStratSession({
            asian_high: sess?.asian_high ?? null,
            asian_low:  sess?.asian_low  ?? null,
          });
        })
        .catch(() => {});
    load();
    const interval = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(interval); };
  }, [pair]);

  useEffect(() => { drawAnnotations(); }, [drawAnnotations, lastCandle]);

  const isUp          = lastCandle ? lastCandle.close >= lastCandle.open : true;
  const change        = lastCandle ? ((lastCandle.close - lastCandle.open) / lastCandle.open * 100) : 0;
  const pendingSetups  = annotations.signals.filter((s) => !s.executed);
  const openTrades     = annotations.trades.filter((t) => t.status === "OPEN");
  const recentClosed   = annotations.trades.filter((t) => t.status === "CLOSED").slice(0, 5);
  const hasAnnotations = pendingSetups.length > 0 || openTrades.length > 0 || recentClosed.length > 0;

  return (
    <div className="flex flex-col h-full">

      {/* Market closed banner */}
      {market.closed && (
        <div
          className="flex items-center justify-between px-4 py-2 text-xs font-medium shrink-0"
          style={{ background: "rgba(255,215,0,0.08)", borderBottom: "1px solid rgba(255,215,0,0.2)", color: "var(--yellow)" }}
        >
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--yellow)" }} />
            {market.label}
          </div>
          <span style={{ color: "var(--text-muted)" }}>
            Opens in {market.opensIn} · Strategy engine paused · Historical candles only
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0 flex-wrap gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3">
          <select
            value={pair}
            onChange={(e) => setPair(e.target.value)}
            className="text-sm font-bold rounded-lg px-2 py-1 outline-none"
            style={{ background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)", color: "var(--accent)" }}
          >
            {PAIRS.map((p) => (
              <option key={p} value={p} style={{ background: "var(--bg-card)", color: "var(--text-primary)" }}>
                {p.slice(0,3)}/{p.slice(3)}
              </option>
            ))}
          </select>

          {lastCandle && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono font-bold" style={{ color: isUp ? "var(--green)" : "var(--red)" }}>
                {FMT(pair, lastCandle.close)}
              </span>
              <span className="text-xs" style={{ color: isUp ? "var(--green)" : "var(--red)" }}>
                {isUp ? "+" : ""}{change.toFixed(3)}%
              </span>
            </div>
          )}

          {pendingSetups.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(255,215,0,0.12)", color: "var(--yellow)", border: "1px solid rgba(255,215,0,0.25)" }}>
              {pendingSetups.length} setup{pendingSetups.length > 1 ? "s" : ""}
            </span>
          )}
          {openTrades.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(0,255,136,0.1)", color: "var(--green)", border: "1px solid rgba(0,255,136,0.25)" }}>
              {openTrades.length} open
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((t) => (
            <button key={t} onClick={() => setTf(t)}
              className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
              style={{
                background: tf === t ? "var(--accent-dim)" : "transparent",
                color: tf === t ? "var(--accent)" : "var(--text-muted)",
                border: tf === t ? "1px solid rgba(0,212,255,0.25)" : "1px solid transparent",
              }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Chart canvas */}
      <div className="relative flex-1">
        <div ref={containerRef} className="w-full h-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(8,8,15,0.75)" }}>
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--accent)" }}>
              <span className="w-1.5 h-1.5 rounded-full live-dot" style={{ background: "var(--accent)" }} />
              Loading {pair} {tf}…
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: "var(--red)" }}>
            Failed to load · {error}
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <div className="shrink-0" style={{ borderTop: "1px solid var(--border)" }}>

        {/* OHLC row */}
        {lastCandle && (
          <div className="flex items-center gap-6 px-4 py-1.5 text-xs" style={{
            color: "var(--text-muted)",
            borderBottom: hasAnnotations ? "1px solid var(--border)" : "none",
          }}>
            {(["O","H","L","C"] as const).map((label, i) => {
              const val = [lastCandle.open, lastCandle.high, lastCandle.low, lastCandle.close][i];
              return (
                <span key={label}>
                  <span>{label} </span>
                  <span className="font-mono" style={{ color: "var(--text-primary)" }}>{FMT(pair, val)}</span>
                </span>
              );
            })}
            <span className="ml-auto" style={{ color: "var(--text-muted)" }}>60s refresh · Yahoo Finance</span>
          </div>
        )}

        {/* Setup / trade level cards */}
        {hasAnnotations && (
          <div className="px-4 py-3 flex flex-wrap gap-3">
            {pendingSetups.map((sig) => (
              <LevelCard
                key={`sig-${sig.id}`}
                type="SETUP"
                direction={sig.direction}
                entry={sig.entry_price}
                sl={sig.stop_loss}
                tp={sig.take_profit}
                pair={pair}
              />
            ))}
            {openTrades.map((trade) => (
              <LevelCard
                key={`trade-${trade.id}`}
                type="OPEN"
                direction={trade.direction}
                entry={trade.entry_price}
                sl={trade.stop_loss}
                tp={trade.take_profit}
                pair={pair}
              />
            ))}
            {recentClosed.map((trade) => (
              <LevelCard
                key={`closed-${trade.id}`}
                type="CLOSED"
                direction={trade.direction}
                entry={trade.entry_price}
                sl={trade.stop_loss}
                tp={trade.take_profit}
                closePrice={trade.close_price}
                pnl={trade.pnl}
                pair={pair}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LevelCard({ type, direction, entry, sl, tp, closePrice, pnl, pair }: {
  type: "SETUP" | "OPEN" | "CLOSED";
  direction: string;
  entry: number | null;
  sl: number | null;
  tp: number | null;
  closePrice?: number | null;
  pnl?: number | null;
  pair: string;
}) {
  const isLong   = direction === "LONG";
  const dirColor = isLong ? "var(--green)" : "var(--red)";
  const rr       = riskReward(entry, sl, tp);
  const isClosed = type === "CLOSED";
  const won      = isClosed && pnl != null ? pnl > 0 : null;

  const ps = pair.includes("JPY") ? 0.01 : 0.0001;
  const riskPips   = entry != null && sl != null ? (Math.abs(entry - sl)  / ps).toFixed(1) : null;
  const rewardPips = entry != null && tp != null ? (Math.abs(tp - entry)  / ps).toFixed(1) : null;
  const closePips  = entry != null && closePrice != null
    ? ((isLong ? closePrice - entry : entry - closePrice) / ps).toFixed(1) : null;

  const typeColor =
    type === "SETUP"  ? "var(--yellow)" :
    type === "OPEN"   ? "var(--green)"  :
    won === true      ? "var(--green)"  :
    won === false     ? "var(--red)"    : "var(--text-muted)";

  const typeBg =
    type === "SETUP"  ? "rgba(255,215,0,0.15)"  :
    type === "OPEN"   ? "rgba(0,255,136,0.15)"  :
    won === true      ? "rgba(0,255,136,0.12)"  :
    won === false     ? "rgba(255,51,102,0.12)" : "rgba(100,100,100,0.15)";

  const typeLabel =
    type === "SETUP"  ? "SETUP"   :
    type === "OPEN"   ? "OPEN"    :
    won === true      ? "TP HIT"  :
    won === false     ? "SL HIT"  : "CLOSED";

  return (
    <div
      className="rounded-xl overflow-hidden text-xs"
      style={{
        border: `1px solid ${isClosed ? (won ? "rgba(0,255,136,0.20)" : "rgba(255,51,102,0.20)") : dirColor + "30"}`,
        minWidth: 220,
        opacity: isClosed ? 0.75 : 1,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5"
        style={{ background: isClosed ? "rgba(255,255,255,0.04)" : `${dirColor}12`, borderBottom: `1px solid ${isClosed ? "var(--border)" : dirColor + "20"}` }}>
        <div className="flex items-center gap-2 font-bold" style={{ color: isClosed ? "var(--text-muted)" : dirColor }}>
          <span>{isLong ? "▲" : "▼"}</span>
          <span>{pair.slice(0,3)}/{pair.slice(3)} {direction}</span>
        </div>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={{ background: typeBg, color: typeColor }}>
          {typeLabel}
        </span>
      </div>

      {/* Levels */}
      <div className="px-3 py-2 space-y-1.5" style={{ background: "rgba(255,255,255,0.02)" }}>
        <LevelRow icon="⟶" label="Entry"       value={entry       != null ? FMT(pair, entry)      : "—"} color="var(--accent)" />
        <LevelRow icon="✕" label="Stop Loss"    value={sl          != null ? FMT(pair, sl)         : "—"}
          sub={riskPips   ? `${riskPips} pips`   : undefined} color="var(--red)" />
        <LevelRow icon="✓" label="Take Profit"  value={tp          != null ? FMT(pair, tp)         : "—"}
          sub={rewardPips ? `${rewardPips} pips` : undefined} color="var(--green)" />
        {isClosed && closePrice != null && (
          <LevelRow
            icon="◉"
            label="Closed at"
            value={FMT(pair, closePrice)}
            sub={closePips != null ? `${Number(closePips) >= 0 ? "+" : ""}${closePips} pips` : undefined}
            color={won ? "var(--green)" : "var(--red)"}
          />
        )}
      </div>

      {/* Footer: R:R or P&L */}
      {(rr || (isClosed && pnl != null)) && (
        <div className="px-3 py-1.5 flex justify-between items-center"
          style={{ background: "rgba(255,255,255,0.02)", borderTop: "1px solid var(--border)" }}>
          {rr && <span style={{ color: "var(--text-muted)" }}>R : R  <span className="font-mono font-semibold" style={{ color: "var(--accent)" }}>{rr}</span></span>}
          {isClosed && pnl != null && (
            <span className="font-mono font-bold ml-auto" style={{ color: pnl >= 0 ? "var(--green)" : "var(--red)" }}>
              {formatAED(pnl, { sign: true })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function LevelRow({ icon, label, value, sub, color }: {
  icon: string; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-1.5">
        <span style={{ color, fontSize: 10 }}>{icon}</span>
        <span style={{ color: "var(--text-muted)" }}>{label}</span>
      </div>
      <div className="flex items-center gap-2 font-mono">
        <span className="font-semibold" style={{ color }}>{value}</span>
        {sub && <span style={{ color: "var(--text-muted)" }}>{sub}</span>}
      </div>
    </div>
  );
}
