import {
  type ISeriesPrimitive,
  type IPrimitivePaneView,
  type IPrimitivePaneRenderer,
  type SeriesAttachedParameter,
  type IChartApiBase,
  type ISeriesApi,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type Signal = { id: number; pair: string; direction: string; entry_price: number | null; stop_loss: number | null; take_profit: number | null; created_at: number; executed: number };
type Trade  = { id: number; pair: string; direction: string; entry_price: number; stop_loss: number | null; take_profit: number | null; close_price: number | null; pnl: number; status: string; open_time: number; close_time: number | null };

export interface OverlayData {
  signals:    Signal[];
  trades:     Trade[];
  candles:    Candle[];
  asianHigh:  number | null;
  asianLow:   number | null;
  todayStr:   string;
}

// ─── Session definitions ──────────────────────────────────────────────────────
const SESSIONS = [
  { name: "Asia",   startH:  0, endH:  9, fill: "rgba(139,92,246,0.055)", label: "rgba(139,92,246,0.50)" },
  { name: "London", startH:  8, endH: 17, fill: "rgba(251,146,60,0.055)", label: "rgba(251,146,60,0.50)" },
  { name: "NY",     startH: 13, endH: 22, fill: "rgba(34,197,94,0.055)",  label: "rgba(34,197,94,0.50)"  },
];

// ─── Renderer ─────────────────────────────────────────────────────────────────
class OverlayRenderer implements IPrimitivePaneRenderer {
  private _p: ChartOverlayPrimitive;
  constructor(p: ChartOverlayPrimitive) { this._p = p; }

  draw(_target: CanvasRenderingTarget2D): void {}

  drawBackground(target: CanvasRenderingTarget2D): void {
    const { chart, series } = this._p;
    if (!chart || !series) return;

    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio }) => {
      const toX = (ts: number): number | null => {
        const c = chart.timeScale().timeToCoordinate(ts as Time);
        return c !== null ? (c as number) * horizontalPixelRatio : null;
      };
      const toY = (price: number): number | null => {
        const c = series.priceToCoordinate(price);
        return c !== null ? (c as number) * verticalPixelRatio : null;
      };

      ctx.save();
      this._drawSessions(ctx, bitmapSize, toX, verticalPixelRatio);
      this._drawAsianRangeBox(ctx, bitmapSize, toX, toY, verticalPixelRatio);
      this._drawTradeBoxes(ctx, bitmapSize, toX, toY, verticalPixelRatio);
      ctx.restore();
    });
  }

  // ─── Session background bands ──────────────────────────────────────────────
  private _drawSessions(
    ctx:    CanvasRenderingContext2D,
    sz:     { width: number; height: number },
    toX:    (ts: number) => number | null,
    vRatio: number
  ) {
    const range = this._p.chart?.timeScale().getVisibleRange() as { from: number; to: number } | null;
    if (!range) return;

    const startDay = Math.floor(range.from / 86400) * 86400;
    const endDay   = Math.ceil(range.to   / 86400) * 86400;

    for (let day = startDay; day <= endDay; day += 86400) {
      for (const s of SESSIONS) {
        const x1r = toX(day + s.startH * 3600);
        const x2r = toX(day + s.endH   * 3600);
        if (x1r === null && x2r === null) continue;

        const x1 = Math.max(0, x1r ?? 0);
        const x2 = Math.min(sz.width, x2r ?? sz.width);
        if (x2 <= x1) continue;

        ctx.fillStyle = s.fill;
        ctx.fillRect(x1, 0, x2 - x1, sz.height);

        if (x1r !== null && x1r >= 0 && x1r < sz.width) {
          ctx.strokeStyle = s.label.replace("0.50", "0.20");
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(x1r, 0);
          ctx.lineTo(x1r, sz.height);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const labelX = Math.max(x1, x1r ?? 0) + 5;
        if (labelX < x2 - 10) {
          ctx.fillStyle = s.label;
          ctx.font = `${Math.round(9 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
          ctx.textBaseline = "top";
          ctx.textAlign = "left";
          ctx.fillText(s.name, labelX, 5);
        }
      }
    }
  }

  // ─── Asian range box ───────────────────────────────────────────────────────
  private _drawAsianRangeBox(
    ctx:    CanvasRenderingContext2D,
    sz:     { width: number; height: number },
    toX:    (ts: number) => number | null,
    toY:    (price: number) => number | null,
    vRatio: number
  ) {
    const { asianHigh, asianLow, todayStr } = this._p.data;
    if (!asianHigh || !asianLow) return;

    const todayMid = new Date(todayStr + "T00:00:00Z").getTime() / 1000;
    const x1r = toX(todayMid + 2 * 3600);
    const x2r = toX(todayMid + 7 * 3600);
    const y1  = toY(asianHigh);
    const y2  = toY(asianLow);

    if (y1 === null || y2 === null) return;
    const bx1 = Math.max(0, x1r ?? 0);
    const bx2 = Math.min(sz.width, x2r ?? sz.width);
    const by1 = Math.min(y1, y2);
    const by2 = Math.max(y1, y2);

    if (bx2 <= bx1 || by2 <= by1) return;

    ctx.fillStyle = "rgba(139,92,246,0.10)";
    ctx.fillRect(bx1, by1, bx2 - bx1, by2 - by1);

    ctx.strokeStyle = "rgba(139,92,246,0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(bx1, by1); ctx.lineTo(bx2, by1);
    ctx.moveTo(bx1, by2); ctx.lineTo(bx2, by2);
    ctx.stroke();

    if (x1r !== null) {
      ctx.beginPath();
      ctx.moveTo(bx1, by1); ctx.lineTo(bx1, by2);
      ctx.stroke();
    }

    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(bx2, by1); ctx.lineTo(bx2, by2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(139,92,246,0.75)";
    ctx.font = `bold ${Math.round(8 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText("ASIAN RANGE", bx1 + 4, by1 + 3);
  }

  // ─── Trade R:R boxes ───────────────────────────────────────────────────────
  private _drawTradeBoxes(
    ctx:    CanvasRenderingContext2D,
    sz:     { width: number; height: number },
    toX:    (ts: number) => number | null,
    toY:    (price: number) => number | null,
    vRatio: number
  ) {
    const { signals, trades, candles } = this._p.data;
    const nowTs = Math.floor(Date.now() / 1000);

    const nearest = (ts: number) =>
      candles.length
        ? candles.reduce((b, c) => Math.abs(c.time - ts) < Math.abs(b.time - ts) ? c : b).time
        : ts;

    // Pending signals
    for (const sig of signals.filter((s) => !s.executed)) {
      if (!sig.entry_price || !sig.stop_loss || !sig.take_profit) continue;
      const decimals = sig.pair.toUpperCase().includes("JPY") ? 3 : 5;
      this._rrBox(ctx, sz, toX, toY, vRatio,
        sig.direction, sig.entry_price, sig.stop_loss, sig.take_profit,
        nearest(sig.created_at), nowTs, false, decimals);
    }

    // Open trades
    for (const t of trades.filter((t) => t.status === "OPEN")) {
      if (!t.stop_loss || !t.take_profit) continue;
      const decimals = t.pair.toUpperCase().includes("JPY") ? 3 : 5;
      this._rrBox(ctx, sz, toX, toY, vRatio,
        t.direction, t.entry_price, t.stop_loss, t.take_profit,
        t.open_time, nowTs, false, decimals);
    }

    // Closed trades (faded, showing actual close outcome)
    for (const t of trades.filter((t) => t.status === "CLOSED" && t.close_time)) {
      if (!t.stop_loss || !t.take_profit) continue;
      const decimals = t.pair.toUpperCase().includes("JPY") ? 3 : 5;
      this._rrBox(ctx, sz, toX, toY, vRatio,
        t.direction, t.entry_price, t.stop_loss, t.take_profit,
        t.open_time, t.close_time!, true, decimals,
        t.close_price ?? undefined);
    }
  }

  private _rrBox(
    ctx:        CanvasRenderingContext2D,
    sz:         { width: number; height: number },
    toX:        (ts: number) => number | null,
    toY:        (price: number) => number | null,
    vRatio:     number,
    dir:        string,
    entry:      number,
    sl:         number,
    tp:         number,
    tStart:     number,
    tEnd:       number,
    faded:      boolean,
    decimals:   number,
    closePrice?: number,
  ) {
    const alpha = faded ? 0.45 : 1;
    const isLong = dir === "LONG";

    const x1r = toX(tStart);
    const x2r = toX(tEnd);
    const yE  = toY(entry);
    const ySL = toY(sl);
    const yTP = toY(tp);

    if (x1r === null || yE === null || ySL === null || yTP === null) return;

    const bx1   = Math.max(0, x1r);
    const bx2   = x2r !== null ? Math.min(sz.width, x2r) : sz.width;
    if (bx2 <= bx1) return;

    // Label anchor: right edge of visible box (near price axis — TradingView style)
    const labelRight = bx2 - 4;

    const risk   = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    const rr     = risk > 0 ? (reward / risk).toFixed(1) : null;

    const fmt = (v: number) => v.toFixed(decimals);

    // ── Vertical line at trade entry time ─────────────────────────────────────
    if (x1r >= 0 && x1r < sz.width) {
      const boxTop    = Math.min(ySL, yTP);
      const boxBottom = Math.max(ySL, yTP);
      ctx.strokeStyle = `rgba(0,212,255,${0.45 * alpha})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(bx1, boxTop);
      ctx.lineTo(bx1, boxBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Risk zone (entry → SL) ─────────────────────────────────────────────
    const riskT = Math.min(yE, ySL);
    const riskB = Math.max(yE, ySL);
    if (riskB > riskT) {
      ctx.fillStyle = `rgba(255,51,102,${0.10 * alpha})`;
      ctx.fillRect(bx1, riskT, bx2 - bx1, riskB - riskT);

      ctx.strokeStyle = `rgba(255,51,102,${0.40 * alpha})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(bx1, riskT, bx2 - bx1, riskB - riskT);

      // SL label — right-aligned at right edge (TradingView style)
      ctx.fillStyle = `rgba(255,51,102,${0.85 * alpha})`;
      ctx.font = `bold ${Math.round(8 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "right";
      ctx.fillText(`SL  ${fmt(sl)}`, labelRight, riskB - 3);

      // Pips label — right-aligned inside zone (smaller, dimmer)
      if (riskB - riskT > 16 * vRatio) {
        const pips = (risk / (decimals === 3 ? 0.01 : 0.0001)).toFixed(1);
        ctx.fillStyle = `rgba(255,51,102,${0.45 * alpha})`;
        ctx.font = `${Math.round(7.5 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(`${pips} pips`, labelRight, riskT + 3);
      }
    }

    // ── Reward zone (entry → TP) ──────────────────────────────────────────
    const rdT = Math.min(yE, yTP);
    const rdB = Math.max(yE, yTP);
    if (rdB > rdT) {
      ctx.fillStyle = `rgba(0,255,136,${0.09 * alpha})`;
      ctx.fillRect(bx1, rdT, bx2 - bx1, rdB - rdT);

      ctx.strokeStyle = `rgba(0,255,136,${0.40 * alpha})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(bx1, rdT, bx2 - bx1, rdB - rdT);

      // TP label — right-aligned at right edge
      ctx.fillStyle = `rgba(0,255,136,${0.85 * alpha})`;
      ctx.font = `bold ${Math.round(8 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
      ctx.textBaseline = "top";
      ctx.textAlign = "right";
      ctx.fillText(`TP  ${fmt(tp)}`, labelRight, rdT + 3);

      // Pips label
      if (rdB - rdT > 16 * vRatio) {
        const pips = (reward / (decimals === 3 ? 0.01 : 0.0001)).toFixed(1);
        ctx.fillStyle = `rgba(0,255,136,${0.45 * alpha})`;
        ctx.font = `${Math.round(7.5 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
        ctx.textBaseline = "bottom";
        ctx.fillText(`${pips} pips`, labelRight, rdB - 3);
      }

      // R:R ratio centred in the reward zone
      if (rr && rdB - rdT > 22 * vRatio) {
        const midX = (bx1 + bx2) / 2;
        const midY = (rdT + rdB) / 2;
        ctx.fillStyle = `rgba(0,255,136,${0.50 * alpha})`;
        ctx.font = `bold ${Math.round(9 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(`1:${rr}`, midX, midY);
      }
    }

    // ── Entry line ─────────────────────────────────────────────────────────
    ctx.strokeStyle = `rgba(0,212,255,${0.75 * alpha})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(bx1, yE);
    ctx.lineTo(bx2, yE);
    ctx.stroke();
    ctx.setLineDash([]);

    // Entry label — left-aligned at left visible edge
    const entryLabelX = Math.max(bx1, 4);
    ctx.fillStyle = `rgba(0,212,255,${0.90 * alpha})`;
    ctx.font = `bold ${Math.round(8 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
    ctx.textBaseline = isLong ? "bottom" : "top";
    ctx.textAlign = "left";
    ctx.fillText(`${isLong ? "▲" : "▼"} ${fmt(entry)}`, entryLabelX, isLong ? yE - 2 : yE + 2);

    // ── Close marker (closed trades only) ─────────────────────────────────
    if (faded && closePrice != null && x2r !== null && x2r >= 0 && x2r <= sz.width) {
      const yClose = toY(closePrice);
      if (yClose !== null) {
        const won = isLong ? closePrice > entry : closePrice < entry;
        const markerColor = won ? "rgba(0,255,136,0.9)" : "rgba(255,51,102,0.9)";

        // Horizontal line at close price across the box
        ctx.strokeStyle = won ? `rgba(0,255,136,${0.50 * alpha})` : `rgba(255,51,102,${0.50 * alpha})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(bx1, yClose);
        ctx.lineTo(bx2, yClose);
        ctx.stroke();
        ctx.setLineDash([]);

        // Circle dot at close point (right edge)
        ctx.fillStyle = markerColor;
        ctx.beginPath();
        ctx.arc(bx2, yClose, 4 * Math.min(vRatio, 1.5), 0, Math.PI * 2);
        ctx.fill();

        // Close price label
        ctx.fillStyle = markerColor;
        ctx.font = `bold ${Math.round(7.5 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
        ctx.textBaseline = won ? "bottom" : "top";
        ctx.textAlign = "right";
        ctx.fillText(fmt(closePrice), bx2 - 8, won ? yClose - 2 : yClose + 2);
      }
    }

    // Reset text alignment
    ctx.textAlign = "left";
  }
}

// ─── Pane view ────────────────────────────────────────────────────────────────
class OverlayView implements IPrimitivePaneView {
  private _renderer: OverlayRenderer;
  constructor(p: ChartOverlayPrimitive) { this._renderer = new OverlayRenderer(p); }
  zOrder(): "bottom" { return "bottom"; }
  renderer(): OverlayRenderer { return this._renderer; }
}

// ─── Public primitive class ───────────────────────────────────────────────────
export class ChartOverlayPrimitive implements ISeriesPrimitive<Time> {
  chart:  IChartApiBase<Time>           | null = null;
  series: ISeriesApi<SeriesType, Time>  | null = null;
  data:   OverlayData = { signals: [], trades: [], candles: [], asianHigh: null, asianLow: null, todayStr: "" };

  private _requestUpdate: (() => void) | null = null;
  private _views: OverlayView[];

  constructor() { this._views = [new OverlayView(this)]; }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.chart  = chart  as IChartApiBase<Time>;
    this.series = series as ISeriesApi<SeriesType, Time>;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this.chart  = null;
    this.series = null;
    this._requestUpdate = null;
  }

  paneViews(): readonly OverlayView[] { return this._views; }

  update(data: OverlayData) {
    this.data = data;
    this._requestUpdate?.();
  }
}
