import type { HTMLAttributes, ReactNode } from "react";

import styles from "./data-workspace-empty.module.css";

export type DataWorkspaceEmptyState = "empty" | "loading" | "unavailable";

export type DataWorkspaceEmptyProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: ReactNode;
  icon?: ReactNode;
  state?: DataWorkspaceEmptyState;
};

export function DataWorkspaceEmpty({
  children,
  className,
  icon,
  state = "empty",
  ...props
}: DataWorkspaceEmptyProps) {
  return (
    <div
      {...props}
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-state={state}
      data-ui="data-workspace-empty"
    >
      {icon}
      <p>{children}</p>
    </div>
  );
}
