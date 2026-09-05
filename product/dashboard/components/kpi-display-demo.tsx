"use client";

import { useState } from "react";

import { ThemeToggle } from "./theme-toggle";
import { KpiDisplay, type KpiLayout, type KpiMetric } from "./ui/kpi-display";

const layouts: Array<{ value: KpiLayout; label: string }> = [
  { value: "featured-list", label: "Featured" },
  { value: "grid-2x2", label: "2 × 2" },
  { value: "grid-4x1", label: "4 × 1" },
  { value: "grid-1x4", label: "1 × 4" },
  { value: "bento-auto", label: "Bento auto" },
];

const demoMetrics: KpiMetric[] = [
  { id: "revenue", group: "Revenue & users", label: "Total revenue", value: 1285000, format: "currency", emphasis: "primary", delta: { value: 12.4, direction: "up", period: "vs last month" }, trend: [36, 42, 39, 48, 52, 57, 63, 68] },
  { id: "active-users", group: "Revenue & users", label: "Active users", value: 48213, delta: { value: 5.8, direction: "up", period: "month over month" }, trend: [29, 31, 35, 34, 38, 42, 45, 48] },
  { id: "channels", group: "Revenue & users", label: "Acquisition channels", value: 6 },
  { id: "conversion", group: "Conversion boundary", label: "Conversion rate", value: 3.42, format: "percent", emphasis: "primary", target: { value: 5, progress: 68.4 } },
  { id: "retention", group: "Conversion boundary", label: "30-day retention", value: 76.9, format: "percent", delta: { value: 1.2, direction: "up", period: "year over year" }, trend: [70, 72, 71, 73, 74, 75, 76.9] },
  { id: "churn", group: "Conversion boundary", label: "Churn", value: 2.8, format: "percent", delta: { value: 0.4, direction: "down", period: "vs last month" } },
];

export function KpiDisplayDemo() {
  const [layout, setLayout] = useState<KpiLayout>("featured-list");
  return (
    <main className="kpi-demo-page">
      <header className="kpi-demo-header">
        <div>
          <span>Component laboratory</span>
          <h1>KPI display</h1>
          <p>One data contract, five layout strategies, and no decorative metric cards.</p>
        </div>
        <ThemeToggle />
      </header>
      <nav className="kpi-demo-switcher" aria-label="KPI layout">
        {layouts.map((item) => (
          <button key={item.value} type="button" data-active={layout === item.value || undefined}
            onClick={() => setLayout(item.value)}>{item.label}</button>
        ))}
      </nav>
      <KpiDisplay metrics={demoMetrics} layout={layout} currency="CNY" percentFractionDigits={2}
        aria-label={`${layout} KPI example`} />
      <footer className="kpi-demo-note">
        <span>Responsive</span>
        <span>CSS variable theme</span>
        <span>Semantic color only</span>
      </footer>
    </main>
  );
}
