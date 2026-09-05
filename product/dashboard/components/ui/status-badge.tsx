import type { HTMLAttributes, ReactNode } from "react";

export type StatusBadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "protected"
  | "unavailable";

export function StatusBadge({
  children,
  tone = "neutral",
  className,
  ...props
}: {
  children: ReactNode;
  tone?: StatusBadgeTone;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">) {
  return (
    <span
      {...props}
      className={["status-badge", className].filter(Boolean).join(" ")}
      data-tone={tone}
    >
      {children}
    </span>
  );
}
