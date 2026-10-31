import type { ReactNode } from "react";
import { Missing } from "./Missing";

/** Label/value pairs in two aligned columns; labels muted, values in the text colour. `labels` fixes the
 *  label column's width, so several sections of one window line their values up. */
export function KeyValues({ items, labels }: { items: readonly (readonly [string, ReactNode])[]; labels?: "fixed" }) {
  return (
    <dl className={`grid ${labels ? "grid-cols-[8.5rem_minmax(0,1fr)]" : "grid-cols-[auto_minmax(0,1fr)]"} gap-x-4 gap-y-0.5`}>
      {items.map(([k, value]) => (
        <div key={k} className="contents"><dt className="text-fg-faint">{k}</dt><dd className="min-w-0">{value ?? <Missing />}</dd></div>
      ))}
    </dl>
  );
}
