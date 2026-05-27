"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  Settings,
  Zap,
  CandlestickChart,
  Bot,
  History,
} from "lucide-react";

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/charts", label: "Charts", icon: CandlestickChart },
  { href: "/trades", label: "Trades", icon: TrendingUp },
  { href: "/analysis", label: "Analysis", icon: BarChart3 },
  { href: "/backtest", label: "Backtest", icon: History },
  { href: "/strategy", label: "Strategy", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside
      className="flex flex-col w-[220px] min-h-screen shrink-0 glass"
      style={{ borderRight: "1px solid var(--border)", borderRadius: 0 }}
    >
      {/* Logo */}
      <div className="px-6 pt-8 pb-6">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "var(--accent-dim)", border: "1px solid var(--accent)" }}
          >
            <Zap size={16} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <div className="text-sm font-bold tracking-widest" style={{ color: "var(--accent)" }}>
              KAIROS
            </div>
            <div className="text-[10px] tracking-widest" style={{ color: "var(--text-muted)" }}>
              FX
            </div>
          </div>
        </div>
      </div>

      {/* Live badge */}
      <div className="px-6 mb-6">
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
          style={{ background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.2)", color: "var(--green)", width: "fit-content" }}
        >
          <span className="w-1.5 h-1.5 rounded-full live-dot" style={{ background: "var(--green)" }} />
          PAPER TRADING
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = path === href;
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm font-medium transition-all"
              style={{
                color: active ? "var(--accent)" : "var(--text-muted)",
                background: active ? "var(--accent-dim)" : "transparent",
                border: active ? "1px solid rgba(0,212,255,0.2)" : "1px solid transparent",
              }}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-6 py-5">
        <div className="text-[10px] tracking-widest" style={{ color: "var(--text-muted)" }}>
          v1.0.0 · PAPER MODE
        </div>
      </div>
    </aside>
  );
}
