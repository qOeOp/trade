"use client";

import type { ReactNode } from "react";

export function DataTableHeaderLabel({ children }: { children: ReactNode }) {
  return <span className="data-table-header-label">{children}</span>;
}

export function DataTableSurface({
  children,
  toolbar,
  toolbarLabel = "Table controls",
  className = "",
}: {
  children: ReactNode;
  toolbar?: ReactNode;
  toolbarLabel?: string;
  className?: string;
}) {
  return (
    <section className={`data-table-surface ${className}`}>
      {toolbar ? <div className="data-table-toolbar" role="toolbar" aria-label={toolbarLabel}>{toolbar}</div> : null}
      {children}
    </section>
  );
}
