import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import { InterfaceIcons } from "./iconography";

export function InsightSummary({
  eyebrow,
  label,
  value,
  detail,
  progress,
  children,
  className,
  ...props
}: {
  eyebrow: ReactNode;
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  progress?: { value: number; max: number; label: ReactNode };
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  const boundedProgress = progress
    ? Math.max(0, Math.min(progress.max, progress.value))
    : 0;
  const progressPercent = progress && progress.max > 0
    ? `${(boundedProgress / progress.max) * 100}%`
    : "0%";

  return (
    <section {...props} className={["insight-summary", className].filter(Boolean).join(" ")}>
      <div className="insight-summary-lead">
        <span className="insight-summary-eyebrow">{eyebrow}</span>
        <span className="insight-summary-label">{label}</span>
        <strong>{value}</strong>
        {detail ? <p>{detail}</p> : null}
        {progress ? <div className="insight-summary-progress">
          <span><b>{progress.value}</b> / {progress.max}<small>{progress.label}</small></span>
          <i role="progressbar" aria-label={String(progress.label)} aria-valuemin={0}
            aria-valuemax={progress.max} aria-valuenow={boundedProgress}>
            <span style={{ "--insight-progress": progressPercent } as CSSProperties} />
          </i>
        </div> : null}
      </div>
      <dl className="insight-summary-facts">{children}</dl>
    </section>
  );
}

export function InsightSummaryFact({
  label,
  value,
  detail,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return <div className="insight-summary-fact">
    <dt>{label}</dt>
    <dd>{value}</dd>
    {detail ? <small>{detail}</small> : null}
  </div>;
}

export function TechnicalDisclosure({
  label,
  summary,
  children,
  className,
}: {
  label: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <details className={["technical-disclosure", className].filter(Boolean).join(" ")}>
    <summary>
      <span><b>{label}</b>{summary ? <small>{summary}</small> : null}</span>
      <InterfaceIcons.expand aria-hidden="true" size={16} />
    </summary>
    <div className="technical-disclosure-content">{children}</div>
  </details>;
}
