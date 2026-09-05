import type { HTMLAttributes, ReactNode } from "react";

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
}: {
  eyebrow: ReactNode;
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={["aggregate-summary-group", className].filter(Boolean).join(" ")}>
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
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="aggregate-summary-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}
