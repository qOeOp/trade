import type { ReactNode } from "react";

/** One of a few filters over a list, as small chips in a row: the chosen one on the selection fill, the
 *  others muted until hovered; each may carry a faint count. Quieter than Segmented, which picks what a
 *  form or view shows. */
export function FilterChips<T extends string>({ items, value, onChange, label }: {
  items: readonly { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (id: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {items.map((item) => {
        const on = item.id === value;
        return (
          <button key={item.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(item.id)}
                  className={`inline-flex h-6 items-center gap-1 rounded-badge px-2 text-small transition-colors ${on ? "bg-selection text-fg" : "text-fg-muted hover:bg-hover hover:text-fg"}`}>
            {item.label}{item.count !== undefined && <span className="text-fg-faint">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
