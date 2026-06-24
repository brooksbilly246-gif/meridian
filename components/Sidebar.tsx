"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  Settings,
  CandlestickChart,
  Bot,
  History,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import MeridianLogo from "./MeridianLogo";

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [path]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // ── Mobile: top bar + slide-out drawer ──
  if (isMobile) {
    return (
      <>
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
            height: 56,
            background: "var(--bg-card)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <MeridianLogo size={26} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              Meridian
            </span>
          </div>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            style={{ background: "none", border: "none", color: "var(--text-secondary)", padding: 8, cursor: "pointer" }}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Overlay */}
        {mobileOpen && (
          <div
            onClick={closeMobile}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 55,
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(4px)",
            }}
          />
        )}

        {/* Drawer */}
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 60,
            width: 260,
            background: "var(--bg-card)",
            borderLeft: "1px solid var(--border)",
            transform: mobileOpen ? "translateX(0)" : "translateX(100%)",
            transition: "transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 20px 8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <MeridianLogo size={26} />
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Meridian</span>
            </div>
            <button
              onClick={closeMobile}
              style={{ background: "none", border: "none", color: "var(--text-secondary)", padding: 8, cursor: "pointer" }}
            >
              <X size={18} />
            </button>
          </div>

          <div style={{ padding: "12px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "var(--accent)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} className="live-dot" />
              Paper
            </div>
          </div>

          <nav style={{ flex: 1, padding: "0 10px" }}>
            {nav.map(({ href, label, icon: Icon }) => {
              const active = path === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={closeMobile}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 12px",
                    borderRadius: 8,
                    marginBottom: 2,
                    fontSize: 14,
                    textDecoration: "none",
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    background: active ? "var(--accent-dim)" : "transparent",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <Icon size={18} strokeWidth={active ? 2.2 : 1.8} style={{ color: active ? "var(--accent)" : "var(--text-muted)" }} />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div style={{ padding: "16px 20px", fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-data)" }}>
            v2.0.0
          </div>
        </div>

        {/* Spacer so content isn't hidden behind the fixed top bar */}
        <div style={{ width: "100%", height: 56, flexShrink: 0 }} />
      </>
    );
  }

  // ── Desktop: collapsible sidebar ──
  const w = collapsed ? 64 : 220;

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        width: w,
        minHeight: "100vh",
        flexShrink: 0,
        background: "var(--bg-card)",
        borderRight: "1px solid var(--border)",
        transition: "width 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        overflow: "hidden",
      }}
    >
      {/* Logo */}
      <div style={{ padding: collapsed ? "28px 0 4px" : "28px 20px 4px", display: "flex", justifyContent: collapsed ? "center" : "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
          <MeridianLogo size={collapsed ? 28 : 32} />
          {!collapsed && (
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              Meridian
            </span>
          )}
        </div>
      </div>

      {/* Status */}
      <div style={{ padding: collapsed ? "16px 0" : "16px 20px", display: "flex", justifyContent: collapsed ? "center" : "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "var(--accent)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} className="live-dot" />
          {!collapsed && "Paper"}
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "0 10px" }}>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = path === href;
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: collapsed ? "8px 0" : "8px 10px",
                borderRadius: 8,
                marginBottom: 1,
                fontSize: 13,
                textDecoration: "none",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                background: active ? "var(--accent-dim)" : "transparent",
                fontWeight: active ? 600 : 400,
                justifyContent: collapsed ? "center" : "flex-start",
              }}
            >
              <Icon size={15} strokeWidth={active ? 2.2 : 1.8} style={{ color: active ? "var(--accent)" : "var(--text-muted)" }} />
              {!collapsed && label}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div style={{ padding: "0 10px 8px" }}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: collapsed ? "8px 0" : "8px 10px",
            borderRadius: 8,
            fontSize: 11,
            color: "var(--text-muted)",
            background: "none",
            border: "none",
            cursor: "pointer",
            justifyContent: collapsed ? "center" : "flex-start",
          }}
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          {!collapsed && "Collapse"}
        </button>
      </div>

      {/* Version */}
      <div style={{ padding: collapsed ? "0 0 16px" : "0 20px 16px", display: "flex", justifyContent: collapsed ? "center" : "flex-start" }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-data)" }}>
          {collapsed ? "2.0" : "v2.0.0"}
        </span>
      </div>
    </aside>
  );
}
