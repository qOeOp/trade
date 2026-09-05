import type { HTMLAttributes, ReactNode } from "react";

export function EvidenceStrip({
  children,
  className,
  layout = "facts",
  ...props
}: {
  children: ReactNode;
  layout?: "facts" | "correlation" | "result";
} & HTMLAttributes<HTMLElement>) {
  return (
    <section {...props} className={["evidence-strip", className].filter(Boolean).join(" ")} data-layout={layout}>
      {children}
    </section>
  );
}

export function EvidenceField({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <div className={["evidence-field", className].filter(Boolean).join(" ")}><span>{label}</span>{children}</div>;
}

export function EvidenceActions({ children }: { children: ReactNode }) {
  return <div className="evidence-actions">{children}</div>;
}

export function UnavailableState({
  icon,
  title,
  reason,
  detail,
  density = "regular",
}: {
  icon: ReactNode;
  title: ReactNode;
  reason: ReactNode;
  detail?: ReactNode;
  density?: "regular" | "compact";
}) {
  return <div className="unavailable-state" data-density={density}>{icon}<div><b>{title}</b>{detail ? <p>{detail}</p> : null}<code>{reason}</code></div></div>;
}

export function EmptyState({
  icon,
  title,
  children,
  density = "regular",
}: {
  icon?: ReactNode;
  title: ReactNode;
  children: ReactNode;
  density?: "regular" | "compact";
}) {
  return (
    <div className="empty-state" data-density={density}>
      {icon}
      <div><b>{title}</b><p>{children}</p></div>
    </div>
  );
}
