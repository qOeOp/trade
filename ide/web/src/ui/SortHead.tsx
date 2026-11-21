import type { ReactNode } from "react";
import { Icon } from "../icons/Icon";

/** A table header's label as a sort button, for a table that sorts by one key at a time: the arrow (`dir`, the order the
 *  key sorts in) shows while it is the `active` key, outside the label as DataTable's does, so headers line up with their
 *  column's values. */
export function SortHead({ children, active, dir, onSort, align = "center" }: {
  children: ReactNode; active: boolean; dir: "asc" | "desc"; onSort: () => void; align?: "center" | "right";
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onSort}
            className={`relative inline-flex cursor-pointer select-none items-center rounded-xs hover:text-fg ${active ? "text-fg-muted" : ""}`}>
      {children}
      {active && (
        <span className={`absolute top-1/2 flex -translate-y-1/2 text-fg-ghost ${align === "right" ? "right-full" : "left-full"}`}>
          <Icon name={dir === "asc" ? "arrow-up" : "arrow-down"} size={12} />
        </span>
      )}
    </button>
  );
}
