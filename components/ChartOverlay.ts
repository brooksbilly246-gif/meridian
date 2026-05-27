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
// Standard forex session hours in UTC
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
      this._drawSetupBoxes(ctx, bitmapSize, toX, toY, verticalPixelRatio);
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

        // Background fill
        ctx.fillStyle = s.fill;
        ctx.fillRect(x1, 0, x2 - x1, sz.height);

        // Left-edge vertical line
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

        // Session label near top-left of band
        const labelX = Math.max(x1, x1r ?? 0) + 5;
        if (labelX < x2 - 10) {
          ctx.fillStyle = s.label;
          ctx.font = `${Math.round(9 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
          ctx.textBaseline = "top";
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
    // Box spans the Asian session build window (02:00-07:00 UTC)
    const x1r = toX(todayMid + 2 * 3600);
    const x2r = toX(todayMid + 7 * 3600);
    const y1  = toY(asianHigh);
    const y2  = toY(asianLow);

    if (y1 === null || y2 === null) return;
    // Allow box to extend to right chart edge if still in/past Asian window
    const bx1 = Math.max(0, x1r ?? 0);
    const bx2 = Math.min(sz.width, x2r ?? sz.width);
    const by1 = Math.min(y1, y2);
    const by2 = Math.max(y1, y2);

    if (bx2 <= bx1 || by2 <= by1) return;

    // Fill
    ctx.fillStyle = "rgba(139,92,246,0.10)";
    ctx.fillRect(bx1, by1, bx2 - bx1, by2 - by1);

    // Top and bottom borders (solid)
    ctx.strokeStyle = "rgba(139,92,246,0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(bx1, by1); ctx.lineTo(bx2, by1); // top
    ctx.moveTo(bx1, by2); ctx.lineTo(bx2, by2); // bottom
    ctx.stroke();

    // Left border (solid)
    if (x1r !== null) {
      ctx.beginPath();
      ctx.moveTo(bx1, by1); ctx.lineTo(bx1, by2);
      ctx.stroke();
    }

    // Right border (dashed — range is "locked in")
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(bx2, by1); ctx.lineTo(bx2, by2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = "rgba(139,92,246,0.75)";
    ctx.font = `bold ${Math.round(8 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText("ASIAN RANGE", bx1 + 4, by1 + 3);
  }

  // ─── Setup / trade R:R boxes ───────────────────────────────────────────────
  private _drawSetupBoxes(
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

    for (const sig of signals.filter((s) => !s.executed)) {
      if (!sig.entry_price || !sig.stop_loss || !sig.take_profit) continue;
      this._rrBox(ctx, sz, toX, toY, vRatio, sig.direction, sig.entry_price, sig.stop_loss, sig.take_profit, nearest(sig.created_at), nowTs, false);
    }
    for (const t of trades.filter((t) => t.status === "OPEN")) {
      if (!t.stop_loss || !t.take_profit) continue;
      this._rrBox(ctx, sz, toX, toY, vRatio, t.direction, t.entry_price, t.stop_loss, t.take_profit, t.open_time, nowTs, false);
    }
    for (const t of trades.filter((t) => t.status === "CLOSED" && t.close_time)) {
      if (!t.stop_loss || !t.take_profit) continue;
      this._rrBox(ctx, sz, toX, toY, vRatio, t.direction, t.entry_price, t.stop_loss, t.take_profit, t.open_time, t.close_time!, true);
    }
  }

  private _rrBox(
    ctx:    CanvasRenderingContext2D,
    sz:     { width: number; height: number },
    toX:    (ts: number) => number | null,
    toY:    (price: number) => number | null,
    vRatio: number,
    dir:    string,
    entry:  number,
    sl:     number,
    tp:     number,
    tStart: number,
    tEnd:   number,
    faded:  boolean
  ) {
    const a  = faded ? 0.35 : 1;
    const x1r = toX(tStart);
    const x2r = toX(tEnd);
    const yE  = toY(entry);
    const ySL = toY(sl);
    const yTP = toY(tp);

    if (x1r === null || yE === null || ySL === null || yTP === null) return;

    const bx1 = Math.max(0, x1r);
    // For active setups tEnd is nowTs — extend to right edge if off-screen
    const bx2 = x2r !== null ? Math.min(sz.width, x2r) : sz.width;
    if (bx2 <= bx1) return;

    // ── Risk zone (entry → SL) red ─────────────────────────────────────────
    const rt = Math.min(yE, ySL);
    const rb = Math.max(yE, ySL);
    if (rb > rt) {
      ctx.fillStyle = `rgba(255,51,102,${0.11 * a})`;
      ctx.fillRect(bx1, rt, bx2 - bx1, rb - rt);
      ctx.strokeStyle = `rgba(255,51,102,${0.55 * a})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(bx1, rt, bx2 - bx1, rb - rt);
      if (!faded) {
        ctx.fillStyle = `rgba(255,51,102,${0.70 * a})`;
        ctx.font = `${Math.round(8 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
        ctx.textBaseline = "bottom";
        ctx.fillText(`SL  ${sl.toFixed(dir === "LONG" ? 5 : 5)}`, bx1 + 4, rb - 3);
      }
    }

    // ── Reward zone (entry → TP) green ─────────────────────────────────────
    const rdt = Math.min(yE, yTP);
    const rdb = Math.max(yE, yTP);
    if (rdb > rdt) {
      ctx.fillStyle = `rgba(0,255,136,${0.10 * a})`;
      ctx.fillRect(bx1, rdt, bx2 - bx1, rdb - rdt);
      ctx.strokeStyle = `rgba(0,255,136,${0.55 * a})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(bx1, rdt, bx2 - bx1, rdb - rdt);
      if (!faded) {
        ctx.fillStyle = `rgba(0,255,136,${0.70 * a})`;
        ctx.font = `${Math.round(8 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(`TP  ${tp.toFixed(5)}`, bx1 + 4, rdt + 3);
      }
    }

    // ── Entry line across both zones ───────────────────────────────────────
    if (!faded) {
      ctx.strokeStyle = `rgba(0,212,255,0.80)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(bx1, yE); ctx.lineTo(bx2, yE);
      ctx.stroke();
      ctx.setLineDash([]);

      // Direction label at left edge
      const isLong = dir === "LONG";
      ctx.fillStyle = isLong ? "rgba(0,255,136,0.85)" : "rgba(255,51,102,0.85)";
      ctx.font = `bold ${Math.round(8 * vRatio)}px -apple-system,BlinkMacSystemFont,sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(`${isLong ? "▲" : "▼"} ${dir}`, bx1 + 4, yE);
    }
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
