import type { HTMLAttributes, ReactNode } from "react";

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
      <span className="compact-status-group-label">{label}</span>
      <dl>{children}</dl>
    </div>
  );
}

export function CompactStatusItem({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="compact-status-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
