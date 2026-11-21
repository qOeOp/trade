import type { ReactNode } from "react";
import { Missing } from "./Missing";

/** Label/value pairs in two aligned columns; labels muted, values in the text colour. `labels` fixes the
 *  label column's width. `stackNarrow` gives long values a full row in narrow panels and dialogs. */
export function KeyValues({ items, labels, stackNarrow = false }: { items: readonly (readonly [string, ReactNode])[]; labels?: "fixed"; stackNarrow?: boolean }) {
  const content = (
    <dl className={`grid ${stackNarrow ? labels ? "grid-cols-1 @[24rem]:grid-cols-[var(--key-column)_minmax(0,1fr)]" : "grid-cols-1 @[24rem]:grid-cols-[auto_minmax(0,1fr)]"
      : labels ? "grid-cols-[var(--key-column)_minmax(0,1fr)]" : "grid-cols-[auto_minmax(0,1fr)]"} gap-x-4 gap-y-0.5`}>
      {items.map(([k, value]) => (
        <div key={k} className="contents"><dt className="text-fg-faint">{k}</dt><dd className={`min-w-0 ${stackNarrow ? "mb-2 last:mb-0 @[24rem]:mb-0" : ""}`}>{value ?? <Missing />}</dd></div>
      ))}
    </dl>
  );
  return stackNarrow ? <div className="@container">{content}</div> : content;
}
