import type { HTMLAttributes, ReactNode } from "react";
import type { StatusBadgeTone } from "./status-badge";

export function AggregateSummary({
  children,
  className,
  ...props
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={["aggregate-summary", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export function AggregateSummaryGroup({
  eyebrow,
  label,
  value,
  detail,
  children,
  className,
  tone,
}: {
  eyebrow: ReactNode;
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: StatusBadgeTone;
}) {
  return (
    <section className={["aggregate-summary-group", className].filter(Boolean).join(" ")} data-tone={tone}>
      <span className="aggregate-summary-eyebrow">{eyebrow}</span>
      <div className="aggregate-summary-lead">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
      <dl className="aggregate-summary-facts">{children}</dl>
    </section>
  );
}

export function AggregateSummaryFact({
  label,
  value,
  detail,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: StatusBadgeTone;
}) {
  return (
    <div className="aggregate-summary-fact" data-tone={tone}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}
