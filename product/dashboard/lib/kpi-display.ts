export type KpiMetricFormat = "number" | "currency" | "percent";
export type KpiMetricEmphasis = "primary" | "secondary";
export type KpiVisualization = "sparkline" | "bar" | "none";
export type KpiLayout = "grid-2x2" | "grid-4x1" | "grid-1x4" | "featured-list" | "bento-auto";

export type KpiMetric = {
  id: string;
  label: string;
  value: string | number;
  format?: KpiMetricFormat;
  delta?: { value: number; direction: "up" | "down"; period?: string };
  target?: { value: number; progress: number };
  trend?: number[];
  visualization?: KpiVisualization;
  emphasis?: KpiMetricEmphasis;
  group?: string;
};

export type KpiDisplayOptions = {
  locale?: string;
  currency?: string;
  percentFractionDigits?: number;
};

export type KpiPlacement = {
  id: string;
  score: number;
  columnSpan: number;
  rowSpan: number;
};

export type KpiLayoutPlan = {
  columns: number;
  placements: KpiPlacement[];
};

const numberFormatterCache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, options: Intl.NumberFormatOptions) {
  const key = `${locale}:${JSON.stringify(options)}`;
  const cached = numberFormatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(locale, options);
  numberFormatterCache.set(key, created);
  return created;
}

export function formatKpiValue(
  value: string | number,
  format: KpiMetricFormat = "number",
  options: KpiDisplayOptions = {},
) {
  const locale = options.locale ?? "zh-CN";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);

  if (format === "currency") {
    return formatter(locale, {
      style: "currency",
      currency: options.currency ?? "CNY",
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    }).format(numeric);
  }
  if (format === "percent") {
    return `${formatter(locale, {
      minimumFractionDigits: options.percentFractionDigits ?? 1,
      maximumFractionDigits: options.percentFractionDigits ?? 1,
    }).format(numeric)}%`;
  }
  return formatter(locale, { maximumFractionDigits: 2 }).format(numeric);
}

export function formatKpiDelta(value: number, direction: "up" | "down", locale = "zh-CN") {
  const magnitude = formatter(locale, { maximumFractionDigits: 2 }).format(Math.abs(value));
  return `${direction === "up" ? "+" : "−"}${magnitude}%`;
}

export function normalizeKpiProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  const percentage = progress >= 0 && progress <= 1 ? progress * 100 : progress;
  return Math.min(100, Math.max(0, percentage));
}

export function visualizationFor(metric: KpiMetric): KpiVisualization {
  if (metric.visualization) return metric.visualization;
  if (metric.trend && metric.trend.length > 1) return "sparkline";
  if (metric.target) return "bar";
  return "none";
}

export function scoreKpiMetric(metric: KpiMetric) {
  return (metric.emphasis === "primary" ? 3 : 0)
    + (metric.trend && metric.trend.length > 1 ? 1 : 0)
    + (metric.target ? 1 : 0);
}

export function createBentoAutoPlan(metrics: KpiMetric[]): KpiLayoutPlan {
  const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(Math.max(1, metrics.length)))));
  return {
    columns,
    placements: metrics.map((metric) => {
      const score = scoreKpiMetric(metric);
      const columnSpan = columns > 1 && score >= 3 ? Math.min(2, columns) : 1;
      const rowSpan = metrics.length > columns && score >= 4 ? 2 : 1;
      return { id: metric.id, score, columnSpan, rowSpan };
    }),
  };
}

export function columnsForKpiLayout(layout: Exclude<KpiLayout, "featured-list" | "bento-auto">) {
  if (layout === "grid-4x1") return 4;
  if (layout === "grid-1x4") return 1;
  return 2;
}

export function groupKpiMetrics(metrics: KpiMetric[]) {
  const groups = new Map<string, KpiMetric[]>();
  for (const metric of metrics) {
    const key = metric.group?.trim() || "Overview";
    const existing = groups.get(key);
    if (existing) existing.push(metric);
    else groups.set(key, [metric]);
  }
  return [...groups].map(([label, items]) => ({ label, metrics: items }));
}
