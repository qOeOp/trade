import type { HTMLAttributes, ReactNode } from "react";

import styles from "./data-workspace-empty.module.css";

export type DataWorkspaceEmptyState = "empty" | "loading" | "unavailable";

export type DataWorkspaceEmptyProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  action?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  state?: DataWorkspaceEmptyState;
};

export function DataWorkspaceEmpty({
  action,
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
      data-has-action={action ? "true" : undefined}
      data-state={state}
      data-ui="data-workspace-empty"
    >
      <div className={styles.message}>
        {icon}
        <p>{children}</p>
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
