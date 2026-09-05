import type { HTMLAttributes, ReactNode } from "react";

export function PageStack({
  children,
  className,
  gap = "default",
  ...props
}: {
  children: ReactNode;
  gap?: "default" | "compact";
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["page-stack", className].filter(Boolean).join(" ")}
      data-gap={gap}
    >
      {children}
    </div>
  );
}
