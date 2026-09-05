import type { CSSProperties } from "react";

import {
  columnsForKpiLayout,
  createBentoAutoPlan,
  formatKpiDelta,
  formatKpiValue,
  groupKpiMetrics,
  normalizeKpiProgress,
  visualizationFor,
  type KpiDisplayOptions,
  type KpiLayout,
  type KpiMetric,
} from "../../lib/kpi-display";

export type { KpiLayout, KpiMetric } from "../../lib/kpi-display";

export type KpiDisplayProps = KpiDisplayOptions & {
  metrics: KpiMetric[];
  layout: KpiLayout;
  className?: string;
  "aria-label"?: string;
};

type KpiStyle = CSSProperties & {
  "--kpi-columns"?: number;
  "--kpi-column-span"?: number;
  "--kpi-row-span"?: number;
  "--kpi-featured-span"?: number;
  "--kpi-progress"?: string;
};

function Sparkline({ values, direction }: { values: number[]; direction?: "up" | "down" }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 31 - ((value - min) / spread) * 26;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return (
    <svg className="kpi-sparkline" data-direction={direction} viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MetricVisual({ metric }: { metric: KpiMetric }) {
  const visualization = visualizationFor(metric);
  if (visualization === "sparkline" && metric.trend) {
    return <Sparkline values={metric.trend} direction={metric.delta?.direction} />;
  }
  if (visualization === "bar" && metric.target) {
    const progress = normalizeKpiProgress(metric.target.progress);
    return (
      <div className="kpi-progress" data-state={progress >= 100 ? "met" : "in-progress"}
        role="progressbar" aria-label={`${metric.label} progress`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
        style={{ "--kpi-progress": `${progress}%` } as KpiStyle}>
        <span />
      </div>
    );
  }
  return null;
}

function Metric({ metric, options, featured = false, style }: {
  metric: KpiMetric;
  options: KpiDisplayOptions;
  featured?: boolean;
  style?: KpiStyle;
}) {
  const emphasis = featured ? "primary" : metric.emphasis ?? "secondary";
  return (
    <article className="kpi-metric" data-emphasis={emphasis} style={style}>
      <span className="kpi-label">{metric.label}</span>
      <strong className="kpi-value">{formatKpiValue(metric.value, metric.format, options)}</strong>
      {metric.delta ? (
        <span className="kpi-delta" data-direction={metric.delta.direction}>
          {formatKpiDelta(metric.delta.value, metric.delta.direction, options.locale)}
          {metric.delta.period ? <small>{metric.delta.period}</small> : null}
        </span>
      ) : metric.target ? (
        <span className="kpi-target">Target {formatKpiValue(metric.target.value, metric.format, options)}</span>
      ) : null}
      <MetricVisual metric={metric} />
    </article>
  );
}

export function KpiDisplay({
  metrics,
  layout,
  locale = "zh-CN",
  currency = "CNY",
  percentFractionDigits = 1,
  className,
  "aria-label": ariaLabel = "Key performance indicators",
}: KpiDisplayProps) {
  const groups = groupKpiMetrics(metrics);
  const options = { locale, currency, percentFractionDigits };

  return (
    <section className={["kpi-display", className].filter(Boolean).join(" ")} data-layout={layout} aria-label={ariaLabel}>
      {groups.map((group) => {
        const autoPlan = layout === "bento-auto" ? createBentoAutoPlan(group.metrics) : null;
        const columns = layout === "bento-auto"
          ? autoPlan?.columns ?? 1
          : layout === "featured-list" ? 2 : columnsForKpiLayout(layout);
        const featuredIndex = Math.max(0, group.metrics.findIndex(({ emphasis }) => emphasis === "primary"));
        return (
          <section className="kpi-group" key={group.label}>
            <h2>{group.label}</h2>
            <div className="kpi-metrics" style={{
              "--kpi-columns": columns,
              "--kpi-featured-span": Math.max(1, group.metrics.length - 1),
            } as KpiStyle}>
              {group.metrics.map((metric, index) => {
                const placement = autoPlan?.placements[index];
                return <Metric key={metric.id} metric={metric} options={options}
                  featured={layout === "featured-list" && index === featuredIndex}
                  style={placement ? {
                    "--kpi-column-span": placement.columnSpan,
                    "--kpi-row-span": placement.rowSpan,
                  } : undefined} />;
              })}
            </div>
          </section>
        );
      })}
    </section>
  );
}
