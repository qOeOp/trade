import type { HTMLAttributes, ReactNode } from "react";
import type { StatusBadgeTone } from "./status-badge";

type CompactStatusTone = StatusBadgeTone;

export function CompactStatusBar({
  children,
  className,
  ...props
}: { children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <section {...props} className={["compact-status-bar", className].filter(Boolean).join(" ")}>
      {children}
    </section>
  );
}

export function CompactStatusGroup({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="compact-status-group">
      <span className="compact-status-group-label"><span>{label}</span></span>
      <dl>{children}</dl>
    </div>
  );
}

export function CompactStatusItem({
  label,
  value,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: CompactStatusTone;
}) {
  return (
    <div className="compact-status-item" data-tone={tone}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
