import type { ReactNode } from "react";
import { Missing } from "./Missing";

/** Label/value pairs in two aligned columns; labels muted, values in the text colour. */
export function KeyValues({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5">
      {items.map(([k, value]) => (
        <div key={k} className="contents"><dt className="text-fg-faint">{k}</dt><dd className="min-w-0">{value ?? <Missing />}</dd></div>
      ))}
    </dl>
  );
}
