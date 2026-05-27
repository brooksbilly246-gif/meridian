import CandleChart from "@/components/CandleChart";

export default function ChartsPage() {
  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Charts
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
          Live forex candles · No subscription required
        </p>
      </div>

      <div className="glass rounded-2xl overflow-hidden flex-1 glow-accent" style={{ minHeight: 520 }}>
        <CandleChart pair="EURUSD" tf="1h" height={520} />
      </div>
    </div>
  );
}
