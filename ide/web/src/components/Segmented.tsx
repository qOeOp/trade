import type { ReactNode } from "react";

export type Segment<T> = { id: T; label: ReactNode };

/** A segmented control, as macOS and trading dashboards switch a view: the options sit in a recessed
 *  track on the frame colour, the chosen one raised onto the island with a hairline. `fill` fits it to
 *  a form: as wide, as tall and as round as the fields around it. */
export function Segmented<T extends string>({ items, value, onChange, label, fill = false }: {
  items: readonly Segment<T>[]; value: T; onChange: (id: T) => void; label: string; fill?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`items-center gap-0.5 bg-frame p-0.5 ${fill ? "flex w-full rounded-control" : "inline-flex shrink-0 rounded-popup"}`}>
      {items.map((item) => {
        const on = item.id === value;
        return (
          <button key={item.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(item.id)}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${fill ? "h-6 min-w-0 grow justify-center rounded-badge px-2" : "h-7 rounded-card px-3 text-dense"} ${on ? `bg-island text-fg shadow-raised ring-1 ${fill ? "ring-line-strong" : "ring-line"}` : "text-fg-muted hover:text-fg"}`}>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
