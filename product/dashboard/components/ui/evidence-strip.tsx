import type { ReactNode } from "react";
import { InterfaceIcons } from "./iconography";

export function UnavailableState({
  icon,
  title,
  reason,
  detail,
  density = "regular",
  surface = "row",
}: {
  icon: ReactNode;
  title: ReactNode;
  reason: ReactNode;
  detail?: ReactNode;
  density?: "regular" | "compact";
  surface?: "row" | "card";
}) {
  return (
    <div className="unavailable-state" data-density={density} data-surface={surface}>
      {icon}
      <div><b>{title}</b>{detail ? <p>{detail}</p> : null}</div>
      <details className="unavailable-state-info">
        <summary aria-label="View technical reason" title="Technical reason">
          <InterfaceIcons.info aria-hidden="true" size={14} />
        </summary>
        <code>{reason}</code>
      </details>
    </div>
  );
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

export function LoadingState({
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
    <div className="empty-state" data-density={density} data-state="loading" role="status" aria-busy="true">
      {icon}
      <div><b>{title}</b><p>{children}</p></div>
    </div>
  );
}
