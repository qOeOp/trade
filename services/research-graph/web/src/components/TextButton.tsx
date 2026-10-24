import type { ButtonHTMLAttributes, ReactNode } from "react";

/** A borderless text action (a link to another version, "在图中定位"), with the hover fill of icon buttons. */
export function TextButton({ children, className = "", ...rest }: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`inline-flex items-center gap-1 rounded-control px-1 transition-colors hover:bg-hover hover:text-fg active:bg-pressed ${className}`} {...rest}>
      {children}
    </button>
  );
}
