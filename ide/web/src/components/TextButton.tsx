import type { ButtonHTMLAttributes, ReactNode } from "react";

const HEIGHT = { text: "", inline: "h-5", form: "h-(--form-h)" } as const;

/** A borderless text action (a link to another version, "Locate in graph"), with the hover fill of icon
 *  buttons; `active` makes it a toggle shown pressed while on, as IconButton's. Its `size` is the line's
 *  (`text`), a readout's 20px (`inline`) or a form control's (`form`). It is the action of a header, readout or information row, where a
 *  bordered FormButton (a form's or a dialog footer's) would be too heavy. */
export function TextButton({ children, active, size = "text", className = "", ...rest }: { children: ReactNode; active?: boolean; size?: keyof typeof HEIGHT } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-pressed={active}
            className={`inline-flex ${HEIGHT[size]} items-center gap-1 rounded-control px-1 transition-colors hover:bg-hover hover:text-fg active:bg-pressed disabled:cursor-default disabled:text-fg-ghost disabled:hover:bg-transparent ${active ? "bg-pressed text-fg" : ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}
