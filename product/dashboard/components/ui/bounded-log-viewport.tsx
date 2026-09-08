import type { HTMLAttributes, ReactNode } from "react";

export function BoundedLogViewport({
  children,
  className,
  footer,
  state,
  ...props
}: {
  children: ReactNode;
  footer: ReactNode;
  state: "complete" | "partial_unavailable" | "empty" | "filtered-empty" | "unavailable" | "loading";
} & Omit<HTMLAttributes<HTMLElement>, "children">) {
  return (
    <section
      {...props}
      className={["bounded-log-viewport", className].filter(Boolean).join(" ")}
      data-state={state}
    >
      <div className="bounded-log-viewport-body">{children}</div>
      <footer className="bounded-log-viewport-footer">{footer}</footer>
    </section>
  );
}
