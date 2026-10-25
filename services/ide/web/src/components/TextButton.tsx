import type { ButtonHTMLAttributes, ReactNode } from "react";

/** A borderless text action (a link to another version, "Locate in graph"), with the hover fill of icon
 *  buttons; `active` makes it a toggle shown pressed while on, as IconButton's. */
export function TextButton({ children, active, className = "", ...rest }: { children: ReactNode; active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-pressed={active}
            className={`inline-flex items-center gap-1 rounded-control px-1 transition-colors hover:bg-hover hover:text-fg active:bg-pressed ${active ? "bg-pressed text-fg" : ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}
